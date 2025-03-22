const PDFDocument = require('pdfkit');
const { format } = require('date-fns');
const { fr } = require('date-fns/locale');
const fs = require('fs');
const path = require('path');

// Définir la flèche comme constante globale
const ARROW = ' -> ';

function safeFormatDate(dateValue) {
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return "Date invalide";
    }
    return format(date, 'dd/MM/yyyy', { locale: fr });
  } catch (error) {
    console.error('Erreur lors du formatage de la date:', error);
    return "Date invalide";
  }
}

function sanitizeClientName(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/\s+/g, '_');
}

/**
 * Formate la durée d'une prestation pour affichage lisible (ex: 2h30, 50min, ½ journée)
 */
function formatPrestationDuration(prestation) {
  const totalMin = prestation.duration || 0;

  // Si l'unité est "days"
  if (prestation.durationUnit === 'days') {
    const d = totalMin / 1440;
    if (d === 0.5) return '½ journée';
    if (d === 1) return '1 journée';
    return `${d} jours`;
  }

  // Si l'unité est "hours"
  if (prestation.durationUnit === 'hours') {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (m === 0) return `${h}h`;
    return `${h}h${m}min`;
  }

  // Par défaut, si l'unité est "minutes" ou non spécifiée, on convertit si possible en heures
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}min`;
}

// Pour assurer la compatibilité avec le code existant (ex: drawRectificationInfo)
function formatDuration(prestation) {
  return formatPrestationDuration(prestation);
}

/**
 * Construit la chaîne descriptive d'une prestation
 */
function formatPrestationText(prestation) {
  let text = '';

  if (prestation.billingType === 'hourly') {
    text = `${formatPrestationDuration(prestation)} de ${prestation.description}`;
  } else {
    const quantity = prestation.quantity ?? 1;
    if (prestation.duration && prestation.duration > 0) {
      text = `${quantity} ${prestation.description} de ${formatPrestationDuration(prestation)}`;
    } else {
      text = `${quantity} ${prestation.description}`;
    }
  }
  return text;
}

/**
 * Groupe les prestations par date et additionne les totaux
 */
function groupPrestationsByDate(prestations) {
  const grouped = {};
  prestations.forEach(p => {
    const dateStr = format(new Date(p.date), 'dd/MM/yyyy', { locale: fr });
    if (!grouped[dateStr]) {
      grouped[dateStr] = {
        date: dateStr,
        descriptions: [],
        total: 0
      };
    }
    grouped[dateStr].descriptions.push(formatPrestationText(p));
    // On additionne simplement p.total, car il contient déjà le montant final (fixedPrice × quantity)
    grouped[dateStr].total += p.total;
  });
  return Object.values(grouped);
}

/**
 * Dessine l'entête du tableau (Date / Prestations / Tarifs)
 */
function drawTableHeader(doc, x, y) {
  const headerHeight = 25;
  doc.fillColor('#f3f3f3');
  doc.rect(x, y, 500, headerHeight).fill();
  doc.fillColor('#000000');

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('Date', x + 10, y + 7);
  doc.text('Prestations', x + 120, y + 7);
  doc.text('Tarifs (€)', x + 445, y + 7);

  return headerHeight;
}

/**
 * Ajoute les prestations regroupées par date dans le PDF
 */
function addPrestations(doc, prestations, marginLeft, y, maxY, marginTop) {
  const prestationsWidth = 280;
  doc.font('Helvetica').fontSize(12);
  let isGrey = false;

  const groupedPrestations = groupPrestationsByDate(prestations);

  for (const group of groupedPrestations) {
    const prestationText = group.descriptions.join(' / ');
    const rowHeight = Math.max(
      40,
      doc.heightOfString(prestationText, { width: prestationsWidth }) + 20
    );

    if (y + rowHeight > maxY) {
      doc.addPage();
      y = marginTop;
      drawTableHeader(doc, marginLeft, y);
      y += 25;
    }

    doc.fillColor(isGrey ? '#f9f9f9' : '#ffffff')
      .rect(marginLeft, y, 500, rowHeight)
      .fill();
    doc.fillColor('#000000');

    doc.text(group.date, marginLeft + 10, y + 10);
    doc.text(prestationText, marginLeft + 120, y + 10, { width: prestationsWidth });
    doc.text(`${group.total.toFixed(2)} €`, marginLeft + 400, y + 10, { align: 'right' });

    y += rowHeight;
    isGrey = !isGrey;
  }

  return y;
}

function drawRectificationInfo(doc, rectificationInfo, x, y, maxY, marginTop) {
  const margin = 10;
  // Espacement initial
  y += 5;

  // Réduire l'espace horizontal entre labels et valeurs
  const labelValueGap = 100; // Réduit de 140 à 100

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('NATURE DES MODIFICATIONS', x, y, { align: 'left' });
  y += 20;

  doc.moveTo(x, y - 10).lineTo(x + 500, y - 10).stroke();

  const prestationsAjoutees = rectificationInfo.prestationsModifiees?.filter(m => m.type === 'AJOUTEE') || [];

  const prestationsModifiees = rectificationInfo.prestationsModifiees?.filter(m => {
    if (m.type !== 'MODIFIEE') return false;

    const old = m.anciensDetails;
    const new_ = m.nouveauxDetails;

    return old.description !== new_.description ||
      old.billingType !== new_.billingType ||
      parseFloat(old.hourlyRate || 0) !== parseFloat(new_.hourlyRate || 0) ||
      parseFloat(old.fixedPrice || 0) !== parseFloat(new_.fixedPrice || 0) ||
      parseInt(old.quantity || 1) !== parseInt(new_.quantity || 1) ||
      parseInt(old.duration || 0) !== parseInt(new_.duration || 0) ||
      old.durationUnit !== new_.durationUnit ||
      parseFloat(old.total || 0) !== parseFloat(new_.total || 0);
  }) || [];

  const prestationsSupprimees = rectificationInfo.prestationsModifiees?.filter(m => m.type === 'SUPPRIMEE') || [];

  // Affichage des prestations ajoutées
  if (prestationsAjoutees.length > 0) {
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`1. Ajout de prestations (${prestationsAjoutees.length})`, x, y);
    doc.font('Helvetica').fontSize(11);
    y += 20;

    for (let index = 0; index < prestationsAjoutees.length; index++) {
      const modif = prestationsAjoutees[index];
      const date = safeFormatDate(modif.nouveauxDetails.date);
      const titleText = `${index + 1}. Prestation du ${date}`;
      const descriptionText = `"${modif.nouveauxDetails.description}"`;
      const descriptionWidth = 350;
      const descriptionHeight = doc.heightOfString(descriptionText, { width: descriptionWidth });

      // Calcul dynamique de la hauteur nécessaire
      let requiredContentHeight = 25; // Titre
      requiredContentHeight += Math.max(descriptionHeight, 15); // Libellé

      if (modif.nouveauxDetails.billingType === 'hourly' && modif.nouveauxDetails.hourlyRate) {
        requiredContentHeight += 15; // Taux horaire
      }
      if (modif.nouveauxDetails.billingType !== 'hourly') {
        if (modif.nouveauxDetails.fixedPrice) requiredContentHeight += 15; // Prix unitaire
        if (modif.nouveauxDetails.quantity) requiredContentHeight += 15; // Quantité
      }
      if (modif.nouveauxDetails.duration) {
        requiredContentHeight += 15; // Durée
      }

      // Hauteur de la boîte colorée s'adapte au contenu
      const boxHeight = requiredContentHeight + (margin * 2);

      if (y + boxHeight > maxY) {
        doc.addPage();
        y = marginTop;
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text(`(suite) Ajout de prestations`, x, y);
        doc.font('Helvetica').fontSize(11);
        y += 20;
      }

      doc.fillColor('#f8f9fa');
      doc.rect(x, y, 500, boxHeight).fill();
      doc.fillColor('#000000');

      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(titleText, x + margin, y + margin);
      doc.font('Helvetica').fontSize(11);

      let detailY = y + margin + 25;
      doc.text("Libellé:", x + margin * 2, detailY);
      doc.text(descriptionText, x + labelValueGap, detailY, { width: descriptionWidth });
      detailY += Math.max(descriptionHeight, 15);

      if (modif.nouveauxDetails.billingType === 'hourly') {
        if (modif.nouveauxDetails.hourlyRate) {
          doc.text("Taux horaire:", x + margin * 2, detailY);
          doc.text(`${modif.nouveauxDetails.hourlyRate}€/h`, x + labelValueGap, detailY);
          detailY += 15;
        }
      } else {
        if (modif.nouveauxDetails.fixedPrice) {
          doc.text("Prix unitaire:", x + margin * 2, detailY);
          doc.text(`${modif.nouveauxDetails.fixedPrice}€`, x + labelValueGap, detailY);
          detailY += 15;
        }
        if (modif.nouveauxDetails.quantity) {
          doc.text("Quantité:", x + margin * 2, detailY);
          doc.text(`${modif.nouveauxDetails.quantity}`, x + labelValueGap, detailY);
          detailY += 15;
        }
      }

      if (modif.nouveauxDetails.duration) {
        const formattedDuration = formatDuration({
          duration: modif.nouveauxDetails.duration,
          durationUnit: modif.nouveauxDetails.durationUnit || 'minutes'
        });
        doc.text("Durée:", x + margin * 2, detailY);
        doc.text(formattedDuration, x + labelValueGap, detailY);
      }

      y += boxHeight + 10;
    }
    y += 5;
  }

  // Affichage des prestations modifiées
  if (prestationsModifiees.length > 0) {
    const sectionNumber = prestationsAjoutees.length > 0 ? 2 : 1;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`${sectionNumber}. Modifications de prestations (${prestationsModifiees.length})`, x, y);
    doc.font('Helvetica').fontSize(11);
    y += 20;

    for (let index = 0; index < prestationsModifiees.length; index++) {
      const modif = prestationsModifiees[index];
      const date = safeFormatDate(modif.anciensDetails.date);
      const titleText = `${index + 1}. Modification prestation du ${date}`;

      // Calcul précis de l'espace nécessaire pour chaque élément
      const oldDescriptionText = `"${modif.anciensDetails.description}"`;
      const newDescriptionText = `"${modif.nouveauxDetails.description}"`;
      const descriptionWidth = 350;
      const oldDescriptionHeight = doc.heightOfString(oldDescriptionText, { width: descriptionWidth });
      const newDescriptionHeight = doc.heightOfString(newDescriptionText, { width: descriptionWidth });

      // Calcul dynamique de la hauteur requise
      let requiredContentHeight = 25; // Titre

      // Section AVANT
      requiredContentHeight += 15; // Label "AVANT:"
      requiredContentHeight += Math.max(oldDescriptionHeight, 15); // Libellé AVANT

      if (modif.anciensDetails.billingType === 'hourly') {
        requiredContentHeight += 15; // Taux horaire AVANT
      } else {
        if (modif.anciensDetails.fixedPrice) requiredContentHeight += 15; // Prix unitaire AVANT
        if (modif.anciensDetails.quantity) requiredContentHeight += 15; // Quantité AVANT
      }

      // Espacement entre AVANT et APRÈS
      requiredContentHeight += 10;

      // Section APRÈS
      requiredContentHeight += 15; // Label "APRÈS:"
      requiredContentHeight += Math.max(newDescriptionHeight, 15); // Libellé APRÈS

      if (modif.nouveauxDetails.billingType === 'hourly') {
        requiredContentHeight += 15; // Taux horaire APRÈS
      } else {
        if (modif.nouveauxDetails.fixedPrice) requiredContentHeight += 15; // Prix unitaire APRÈS
        if (modif.nouveauxDetails.quantity) requiredContentHeight += 15; // Quantité APRÈS
      }

      // Ligne pour la différence
      requiredContentHeight += 20;

      // Hauteur totale de la boîte - s'adapte dynamiquement au contenu
      const boxHeight = requiredContentHeight + (margin * 2);

      if (y + boxHeight > maxY) {
        doc.addPage();
        y = marginTop;
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text(`(suite) Modifications de prestations`, x, y);
        doc.font('Helvetica').fontSize(11);
        y += 20;
      }

      // Arrière-plan
      doc.fillColor('#f8f9fa');
      doc.rect(x, y, 500, boxHeight).fill();
      doc.fillColor('#000000');

      // Titre
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(titleText, x + margin, y + margin);
      doc.font('Helvetica').fontSize(11);

      let detailY = y + margin + 25;

      // Section "Avant"
      doc.font('Helvetica-Bold').fontSize(10);
      doc.fillColor('#a71d2a');
      doc.text("AVANT:", x + margin, detailY);
      doc.fillColor('#000000');
      doc.font('Helvetica').fontSize(10);

      detailY += 15;
      doc.text("Libellé:", x + margin * 2, detailY);
      doc.text(oldDescriptionText, x + labelValueGap, detailY, { width: descriptionWidth });
      detailY += Math.max(oldDescriptionHeight, 15);

      if (modif.anciensDetails.billingType === 'hourly') {
        doc.text("Taux horaire:", x + margin * 2, detailY);
        doc.text(`${modif.anciensDetails.hourlyRate}€/h`, x + labelValueGap, detailY);
        detailY += 15;
      } else {
        doc.text("Prix unitaire:", x + margin * 2, detailY);
        doc.text(`${modif.anciensDetails.fixedPrice}€`, x + labelValueGap, detailY);
        detailY += 15;

        doc.text("Quantité:", x + margin * 2, detailY);
        doc.text(`${modif.anciensDetails.quantity || 1}`, x + labelValueGap, detailY);
        detailY += 15;
      }

      // Section "Après"
      detailY += 5;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.fillColor('#007E33');
      doc.text("APRÈS:", x + margin, detailY);
      doc.fillColor('#000000');
      doc.font('Helvetica').fontSize(10);

      detailY += 15;
      doc.text("Libellé:", x + margin * 2, detailY);
      doc.text(newDescriptionText, x + labelValueGap, detailY, { width: descriptionWidth });
      detailY += Math.max(newDescriptionHeight, 15);

      if (modif.nouveauxDetails.billingType === 'hourly') {
        doc.text("Taux horaire:", x + margin * 2, detailY);
        doc.text(`${modif.nouveauxDetails.hourlyRate}€/h`, x + labelValueGap, detailY);
        detailY += 15;
      } else {
        doc.text("Prix unitaire:", x + margin * 2, detailY);
        doc.text(`${modif.nouveauxDetails.fixedPrice}€`, x + labelValueGap, detailY);
        detailY += 15;

        doc.text("Quantité:", x + margin * 2, detailY);
        doc.text(`${modif.nouveauxDetails.quantity || 1}`, x + labelValueGap, detailY);
        detailY += 15;
      }

      // Différence de montant
      const oldTotal = parseFloat(modif.anciensDetails.total || 0);
      const newTotal = parseFloat(modif.nouveauxDetails.total || 0);
      const diff = newTotal - oldTotal;

      detailY += 5;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.fillColor(diff >= 0 ? '#007E33' : '#a71d2a');
      doc.text(`Différence: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}€`, x + 350, detailY, { align: 'right' });
      doc.fillColor('#000000');

      y += boxHeight + 10;
    }
    y += 5;
  }

  // Le reste de la fonction reste essentiellement le même, avec la mise à jour de labelValueGap
  // pour les prestations supprimées aussi...

  // Bloc pour prestations supprimées
  if (prestationsSupprimees.length > 0) {
    let sectionNumber = 1;
    if (prestationsAjoutees.length > 0) sectionNumber++;
    if (prestationsModifiees.length > 0) sectionNumber++;

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`${sectionNumber}. Prestations supprimées (${prestationsSupprimees.length})`, x, y);
    doc.font('Helvetica').fontSize(11);
    y += 20;

    for (let index = 0; index < prestationsSupprimees.length; index++) {
      const modif = prestationsSupprimees[index];
      const date = safeFormatDate(modif.anciensDetails.date);
      const titleText = `${index + 1}. Suppression prestation du ${date}`;
      const descriptionText = `"${modif.anciensDetails.description}"`;
      const descriptionWidth = 350;
      const descriptionHeight = doc.heightOfString(descriptionText, { width: descriptionWidth });

      // Calcul dynamique de la hauteur requise
      let requiredContentHeight = 25; // Titre
      requiredContentHeight += Math.max(descriptionHeight, 15); // Libellé

      if (modif.anciensDetails.billingType === 'hourly') {
        requiredContentHeight += 15; // Taux horaire
      } else {
        if (modif.anciensDetails.fixedPrice) requiredContentHeight += 15; // Prix unitaire
        if (modif.anciensDetails.quantity) requiredContentHeight += 15; // Quantité
      }

      // Ligne pour la différence
      requiredContentHeight += 20;

      // Hauteur totale de la boîte - s'adapte au contenu
      const boxHeight = requiredContentHeight + (margin * 2);

      if (y + boxHeight > maxY) {
        doc.addPage();
        y = marginTop;
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text(`(suite) Prestations supprimées`, x, y);
        doc.font('Helvetica').fontSize(11);
        y += 20;
      }

      // Arrière-plan
      doc.fillColor('#f8f9fa');
      doc.rect(x, y, 500, boxHeight).fill();
      doc.fillColor('#000000');

      // Titre
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(titleText, x + margin, y + margin);
      doc.font('Helvetica').fontSize(11);

      let detailY = y + margin + 25;
      doc.text("Libellé:", x + margin * 2, detailY);
      doc.text(descriptionText, x + labelValueGap, detailY, { width: descriptionWidth });
      detailY += Math.max(descriptionHeight, 15);

      if (modif.anciensDetails.billingType === 'hourly') {
        doc.text("Taux horaire:", x + margin * 2, detailY);
        doc.text(`${modif.anciensDetails.hourlyRate}€/h`, x + labelValueGap, detailY);
        detailY += 15;
      } else {
        doc.text("Prix unitaire:", x + margin * 2, detailY);
        doc.text(`${modif.anciensDetails.fixedPrice}€`, x + labelValueGap, detailY);
        detailY += 15;

        doc.text("Quantité:", x + margin * 2, detailY);
        doc.text(`${modif.anciensDetails.quantity || 1}`, x + labelValueGap, detailY);
        detailY += 15;
      }

      // Différence de montant (toujours négative pour une suppression)
      const oldTotal = parseFloat(modif.anciensDetails.total || 0);

      detailY += 5;
      doc.font('Helvetica-Bold').fontSize(10);
      doc.fillColor('#a71d2a');
      doc.text(`Différence: -${oldTotal.toFixed(2)}€`, x + 350, detailY, { align: 'right' });
      doc.fillColor('#000000');

      y += boxHeight + 10;
    }
    y += 5;
  }

  // Message par défaut si aucune prestation modifiée
  if ((!prestationsAjoutees.length && !prestationsModifiees.length && !prestationsSupprimees.length) && rectificationInfo.detailsMotif) {
    const textHeight = doc.heightOfString(rectificationInfo.detailsMotif, { width: 500 });
    if (y + textHeight + 40 > maxY) {
      doc.addPage();
      y = marginTop;
    }
    doc.font('Helvetica-Oblique').fontSize(11);
    doc.text(rectificationInfo.detailsMotif, x + margin, y + margin, { width: 480 });
    y += textHeight + 30;
  }

  if (!prestationsAjoutees.length && !prestationsModifiees.length && !prestationsSupprimees.length && !rectificationInfo.detailsMotif) {
    doc.font('Helvetica-Oblique').fontSize(11);
    doc.text("Aucun détail disponible", x + margin, y + margin);
    y += 30;
  }

  y += margin;
  if (y + 80 > maxY) {
    doc.addPage();
    y = marginTop;
  }

  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('IMPACT FINANCIER', x, y);
  y += 20;

  doc.fillColor('#e6f7ff');
  doc.rect(x, y, 500, 40).fill();
  doc.fillColor('#000000');

  const diffHT = rectificationInfo.differenceMontantHT || 0;
  const isPositive = diffHT >= 0;

  doc.font(isPositive ? 'Helvetica-Bold' : 'Helvetica').fontSize(11);
  doc.fillColor(isPositive ? '#006400' : '#8b0000');
  doc.text(
    `Différence sur le montant HT : ${isPositive ? '+' : ''}${diffHT.toFixed(2)} €`,
    x + margin, y + 15,
    { width: 480, align: 'center' }
  );

  doc.fillColor('#000000');
  y += 60;

  return y;
}

function drawRecapitulatif(doc, facture, businessInfo, x, y) {
  const boxHeight = businessInfo.tauxTVA && businessInfo.tauxTVA > 0 ? 60 : 40;
  doc.fillColor('#f3f3f3');
  doc.rect(x, y, 500, boxHeight).fill();

  doc.fillColor('#000000').font('Helvetica-Bold');

  if (businessInfo.tauxTVA && businessInfo.tauxTVA > 0) {
    doc.text(
      `TOTAL HT : ${facture.montantHT.toFixed(2)} €`,
      x + 210,
      y + 7,
      { width: 280, align: 'right' }
    );
    doc.text(
      `TVA (${(businessInfo.tauxTVA * 100).toFixed(1)}%) : ${facture.montantTVA.toFixed(2)} €`,
      x + 210,
      y + 27,
      { width: 280, align: 'right' }
    );
    doc.text(
      `NET À PAYER : ${facture.montantTTC.toFixed(2)} €`,
      x + 210,
      y + 47,
      { width: 280, align: 'right' }
    );
  } else {
    if (businessInfo.displayOptions?.showTvaComment) {
      doc.text(
        'TVA non applicable - art.293B du CGI',
        x + 210,
        y + 7,
        { width: 280, align: 'right' }
      );
    }
    doc.text(
      `NET À PAYER : ${facture.montantHT.toFixed(2)} €`,
      x + 210,
      y + (businessInfo.displayOptions?.showTvaComment ? 27 : 7),
      { width: 280, align: 'right' }
    );
  }
}

function drawMessages(doc, facture, businessInfo, x, y, maxY, marginTop) {
  // Si aucun message n'est activé, ne rien faire
  if (!businessInfo.legalMessages?.enableLatePaymentComment &&
    !businessInfo.legalMessages?.enableCustomComment) {
    return y;
  }

  let messageAdded = false;

  // Ajouter le message de retard de paiement s'il est activé
  if (businessInfo.legalMessages?.enableLatePaymentComment &&
    businessInfo.legalMessages?.latePaymentText) {

    // Vérifier s'il faut passer à une nouvelle page
    if (y + 80 > maxY) {
      doc.addPage();
      y = marginTop;
    }

    // Fond gris clair pour mettre en évidence le texte légal
    doc.fillColor('#f8f9fa');
    doc.rect(x, y, 500, 50).fill();
    doc.fillColor('#000000');

    // Titre du message légal
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('INFORMATIONS LÉGALES', x + 10, y + 10);

    // Contenu du message légal
    doc.font('Helvetica').fontSize(10);
    const legalText = businessInfo.legalMessages.latePaymentText;
    const textHeight = doc.heightOfString(legalText, { width: 480 });
    doc.text(legalText, x + 10, y + 25, { width: 480 });

    y += Math.max(50, textHeight + 30);
    messageAdded = true;
  }

  // Ajouter le commentaire personnalisé s'il est activé
  if (businessInfo.legalMessages?.enableCustomComment &&
    businessInfo.legalMessages?.customCommentText) {

    // Vérifier s'il faut passer à une nouvelle page
    if (y + 80 > maxY) {
      doc.addPage();
      y = marginTop;
    }

    // Fond gris clair pour le commentaire personnalisé
    doc.fillColor('#f8f9fa');
    doc.rect(x, y, 500, 50).fill();
    doc.fillColor('#000000');

    // Titre du commentaire personnalisé
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('NOTE', x + 10, y + 10);

    // Contenu du commentaire personnalisé
    doc.font('Helvetica').fontSize(10);
    const customText = businessInfo.legalMessages.customCommentText;
    const textHeight = doc.heightOfString(customText, { width: 480 });
    doc.text(customText, x + 10, y + 25, { width: 480 });

    y += Math.max(50, textHeight + 30);
  }

  return y;  // Retourner la nouvelle position verticale
}

const generateInvoicePDF = async (facture, client, businessInfo, prestations) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        pdfVersion: '1.7',
        tagged: true,
        displayTitle: true,
        info: {
          Title: `Facture_${facture.invoiceNumber}`,
          Author: businessInfo.name,
          Subject: `Facture pour ${client.name}`,
          Keywords: 'facture, invoice',
        }
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const pageHeight = doc.page.height;
      const marginTop = 50;
      const bottomMargin = 50;
      const marginLeft = 50;
      let y = marginTop;
      const maxY = pageHeight - bottomMargin;

      // Bandeaux en haut de page pour factures annulées/rectifiées
      if (facture.status === 'cancelled') {
        doc.fillColor('#ef4444');
        doc.rect(0, 0, doc.page.width, 40).fill();
        doc.fillColor('#ffffff');
        doc.font('Helvetica-Bold').fontSize(18);
        doc.text('FACTURE ANNULÉE', 0, 12, { align: 'center', width: doc.page.width });
        y += 50;
      } else if (facture.statut === 'RECTIFIEE') {
        doc.fillColor('#f59e0b');
        doc.rect(0, 0, doc.page.width, 40).fill();
        doc.fillColor('#ffffff');
        doc.font('Helvetica-Bold').fontSize(16);
        doc.text('FACTURE RECTIFIÉE', 0, 12, { align: 'center', width: doc.page.width });
        y += 50;
      } else if (facture.isRectification) {
        doc.fillColor('#2563eb');
        doc.rect(0, 0, doc.page.width, 40).fill();
        doc.fillColor('#ffffff');
        doc.font('Helvetica-Bold').fontSize(16);
        doc.text('FACTURE RECTIFICATIVE', 0, 12, { align: 'center', width: doc.page.width });
        y += 50;
      }

      // Infos entreprise
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(businessInfo.name, marginLeft, y);
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.address, marginLeft, y + 20);
      doc.text(`${businessInfo.postalCode} ${businessInfo.city}`, marginLeft, y + 35);
      doc.text(`Numéro de portable : ${businessInfo.phone}`, marginLeft, y + 60);
      doc.text(`Email : ${businessInfo.email}`, marginLeft, y + 80);
      doc.text(`Siret : ${businessInfo.siret}`, marginLeft, y + 100);
      doc.text(businessInfo.companyType, marginLeft, y + 120);

      // Infos client
      y += 140;
      const clientInfoX = 380;
      const clientInfoWidth = 180;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(client.name, clientInfoX, y, { width: clientInfoWidth });
      y += 20;
      doc.font('Helvetica').fontSize(12);
      if (client.street) {
        doc.text(client.street, clientInfoX, y, { width: clientInfoWidth });
        y += 20;
      }
      doc.text(`${client.postalCode} ${client.city}`, clientInfoX, y, { width: clientInfoWidth });
      y += 20;
      const dateText = `Le ${format(new Date(facture.dateFacture), 'dd/MM/yyyy', { locale: fr })}`;
      doc.text(dateText, clientInfoX, y, { width: clientInfoWidth });

      // Numéro et titre
      y += 50;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(`Facture N°${facture.invoiceNumber}`, marginLeft, y);
      y += 30;
      doc.font('Helvetica-Bold').fontSize(14);
      doc.text(
        `FACTURE DU MOIS DE ${format(new Date(facture.year, facture.month - 1), 'MMMM yyyy', { locale: fr }).toUpperCase()}`,
        { align: 'center', width: 500 }
      );
      y += 40;

      // Intitulé (si présent)
      if (businessInfo.invoiceTitle) {
        doc.font('Helvetica-Bold').fontSize(12);
        const labelX = doc.text('Intitulé : ', marginLeft, y).x;
        doc.font('Helvetica').fontSize(12);
        doc.text(businessInfo.invoiceTitle, labelX + 50, y, { width: 350, align: 'left' });
        y += 30;
      }

      // Message rectification si applicable
      if (facture.isRectification && facture.rectificationInfo) {
        doc.font('Helvetica').fontSize(11);
        const introText = `Vous trouverez ci-dessous notre correction de facture : La facture du ${format(new Date(facture.rectificationInfo.dateRectification), 'dd/MM/yyyy', { locale: fr })} sous le numéro ${facture.rectificationInfo.originalInvoiceNumber} est par conséquent annulée. Nous souhaitons vous renouveler toutes nos excuses et vous présentons ci-dessous la nouvelle facture effective.`;
        doc.text(introText, marginLeft, y, { width: 500, align: 'left', lineGap: 2 });
        y += doc.heightOfString(introText, { width: 500, lineGap: 2 }) + 20;
      }

      // Entête du tableau des prestations
      drawTableHeader(doc, marginLeft, y);
      y += 25;

      // Liste des prestations
      y = addPrestations(doc, prestations, marginLeft, y, maxY, marginTop);

      // Récapitulatif
      y += 30;
      if (y + 60 > maxY) {
        doc.addPage();
        y = marginTop;
      }
      // Recalcul du total : ici, on additionne p.total directement
      let totalRecalcule = 0;
      for (const p of prestations) {
        totalRecalcule += p.total;
      }
      facture.montantHT = totalRecalcule;
      facture.taxeURSSAF = parseFloat((totalRecalcule * (businessInfo.taxeURSSAF || 0.246)).toFixed(2));
      facture.montantNet = parseFloat((facture.montantHT - facture.taxeURSSAF).toFixed(2));
      if (businessInfo.tauxTVA) {
        facture.montantTVA = parseFloat((facture.montantHT * businessInfo.tauxTVA).toFixed(2));
        facture.montantTTC = parseFloat((facture.montantHT + facture.montantTVA).toFixed(2));
      } else {
        facture.montantTVA = 0;
        facture.montantTTC = facture.montantHT;
      }

      drawRecapitulatif(doc, facture, businessInfo, marginLeft, y);
      y += businessInfo.tauxTVA ? 60 : 40;

      // Détails rectification (si applicable)
      if (facture.isRectification && facture.rectificationInfo) {
        y += 20;
        if (y + 150 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        y = drawRectificationInfo(doc, facture.rectificationInfo, marginLeft, y, maxY, marginTop);
      }

      // Date d'échéance si option activée
      if (businessInfo.displayOptions?.showDueDateOnInvoice) {
        y += 40;
        if (y + 20 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        doc.font('Helvetica').fontSize(12);
        doc.text(`Date d'échéance : ${format(new Date(facture.dateEcheance), 'dd/MM/yyyy', { locale: fr })}`, marginLeft, y);
        y += 30;
      }

      // Ajouter les messages légaux et commentaires personnalisés
      y = drawMessages(doc, facture, businessInfo, marginLeft, y, maxY, marginTop);

      // Filigrane pour facture annulée
      if (facture.status === 'cancelled') {
        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
          doc.switchToPage(i);
          doc.fillColor('#ef4444', 0.25);
          doc.font('Helvetica-Bold').fontSize(100);
          const centerX = doc.page.width / 2;
          const centerY = doc.page.height / 2;
          doc.save();
          doc.rotate(45, { origin: [centerX, centerY] });
          doc.text('ANNULÉE', centerX - 250, centerY - 50, { width: 500, align: 'center' });
          doc.restore();
        }
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  generateInvoicePDF,
  sanitizeClientName,
};

