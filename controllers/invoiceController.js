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

function formatDuration(prestation) {
  const minutes = prestation.duration;
  if (!minutes) return '0min';

  // Si l'unité est spécifiée et que c'est "hours", utiliser le format heures
  if (prestation.durationUnit === 'hours') {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h${mins}min` : `${hours}h`;
  }

  // Si l'unité est spécifiée et que c'est "days"
  if (prestation.durationUnit === 'days') {
    return minutes === 720 ? '½ journée' : '1 journée';
  }

  // Par défaut (minutes ou si unité non spécifiée)
  return `${minutes}min`;
}

function formatPrestationText(prestation) {
  let text = '';

  if (prestation.billingType === 'hourly') {
    text = `${formatDuration(prestation)} de ${prestation.description}`;
  } else {
    const quantity = prestation.quantity ?? 1;
    
    if (prestation.durationUnit === 'days') {
      const duration = formatDuration(prestation);
      text = `${duration} de ${prestation.description}`;
    } else {
      // Plus de pluralSuffix, simplement la quantité et la description
      text = `${quantity} ${prestation.description}`;
      if (prestation.duration && prestation.duration > 0) {
        text += ` de ${formatDuration(prestation)}`;
      }
    }
  }

  return text;
}

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
    grouped[dateStr].total += p.total;
  });
  return Object.values(grouped);
}

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

function addPrestations(doc, prestations, marginLeft, y, maxY, marginTop) {
  const prestationsWidth = 280;
  doc.font('Helvetica').fontSize(12);
  let isGrey = false;

  // Grouper les prestations par date
  const groupedPrestations = groupPrestationsByDate(prestations);

  for (const group of groupedPrestations) {
    // Joindre les descriptions avec " / "
    const prestationText = group.descriptions.join(' / ');
    const rowHeight = Math.max(40, doc.heightOfString(prestationText, { width: prestationsWidth }) + 20);

    // Saut de page si nécessaire
    if (y + rowHeight > maxY) {
      doc.addPage();
      y = marginTop;
      drawTableHeader(doc, marginLeft, y);
      y += 25;
    }

    // Fond alterné
    doc.fillColor(isGrey ? '#f9f9f9' : '#ffffff')
      .rect(marginLeft, y, 500, rowHeight)
      .fill();
    doc.fillColor('#000000');

    // Date
    doc.text(group.date, marginLeft + 10, y + 10);

    // Description
    doc.text(prestationText, marginLeft + 120, y + 10, { width: prestationsWidth });

    // Total
    doc.text(`${group.total.toFixed(2)} €`, marginLeft + 400, y + 10, { align: 'right' });

    y += rowHeight;
    isGrey = !isGrey;
  }

  return y;
}


function drawRectificationInfo(doc, rectificationInfo, x, y) {
  const margin = 10; // Marge standard autour des contenus
  doc.font('Helvetica').fontSize(11);

  // Titre principal avec plus d'espace et en gras
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('NATURE DES MODIFICATIONS', x, y, { align: 'left' });
  y += 20;

  // Tracé d'une ligne horizontale sous le titre principal
  doc.moveTo(x, y - 5).lineTo(x + 500, y - 5).stroke();

  // Traiter les prestations modifiées et nouvelles
  if (rectificationInfo.prestationsModifiees?.length > 0) {
    // Séparer les prestations ajoutées des prestations modifiées
    const prestationsAjoutees = rectificationInfo.prestationsModifiees.filter(m => m.type === 'AJOUTEE');
    const prestationsModifiees = rectificationInfo.prestationsModifiees.filter(m => m.type === 'MODIFIEE');
    
    // 1. D'abord traiter les nouvelles prestations
    if (prestationsAjoutees.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(`1. Ajout de prestations (${prestationsAjoutees.length})`, x, y);
      doc.font('Helvetica').fontSize(11);
      y += 20;
      
      prestationsAjoutees.forEach((modif, index) => {
        const date = safeFormatDate(modif.nouveauxDetails.date);
        
        // Calculer d'abord les hauteurs des textes
        const titleText = `${index + 1}. Prestation du ${date}`;
        const descriptionText = `"${modif.nouveauxDetails.description}"`;
        
        // Calculer la hauteur nécessaire pour la description (avec wrapping)
        const descriptionWidth = 350; // Largeur disponible pour la description
        const descriptionHeight = doc.heightOfString(descriptionText, { 
          width: descriptionWidth
        });
        
        // Calculer une hauteur de base pour les autres détails
        let detailsHeight = 0;
        
        // Ajouter hauteur pour chaque champ présent
        if (modif.nouveauxDetails.billingType === 'hourly' && modif.nouveauxDetails.hourlyRate) {
          detailsHeight += 15;
        }
        
        if (modif.nouveauxDetails.billingType !== 'hourly' && modif.nouveauxDetails.fixedPrice) {
          detailsHeight += 15;
        }
        
        if (modif.nouveauxDetails.billingType !== 'hourly' && modif.nouveauxDetails.quantity) {
          detailsHeight += 15;
        }
        
        if (modif.nouveauxDetails.duration) {
          detailsHeight += 15;
        }
        
        // Hauteur totale: titre + hauteur description + autres détails + marges
        const boxHeight = 30 + Math.max(descriptionHeight, 15) + detailsHeight + (margin * 2);
        
        // Afficher les détails de la nouvelle prestation avec encadrement
        doc.fillColor('#f8f9fa');
        doc.rect(x, y, 500, boxHeight).fill();
        doc.fillColor('#000000');
        
        // Titre de la prestation
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text(titleText, x + margin, y + margin);
        doc.font('Helvetica').fontSize(11);
        
        // Détails structurés en tableau
        let detailY = y + margin + 25; // Position de départ pour les détails
        
        doc.text("Libellé:", x + margin * 2, detailY);
        doc.text(descriptionText, x + 140, detailY, { width: descriptionWidth });
        detailY += Math.max(descriptionHeight, 15); // Ajuster en fonction de la hauteur réelle
        
        // Afficher les détails selon le type de prestation
        if (modif.nouveauxDetails.billingType === 'hourly') {
          if (modif.nouveauxDetails.hourlyRate) {
            doc.text("Taux horaire:", x + margin * 2, detailY);
            doc.text(`${modif.nouveauxDetails.hourlyRate}€/h`, x + 140, detailY);
            detailY += 15;
          }
        } else {
          if (modif.nouveauxDetails.fixedPrice) {
            doc.text("Prix unitaire:", x + margin * 2, detailY);
            doc.text(`${modif.nouveauxDetails.fixedPrice}€`, x + 140, detailY);
            detailY += 15;
          }
          
          if (modif.nouveauxDetails.quantity) {
            doc.text("Quantité:", x + margin * 2, detailY);
            doc.text(`${modif.nouveauxDetails.quantity}`, x + 140, detailY);
            detailY += 15;
          }
        }
        
        // Afficher la durée si présente
        if (modif.nouveauxDetails.duration) {
          const duration = formatDuration({
            duration: modif.nouveauxDetails.duration,
            durationUnit: modif.nouveauxDetails.durationUnit || 'minutes'
          });
          doc.text("Durée:", x + margin * 2, detailY);
          doc.text(duration, x + 140, detailY);
        }
        
        y += boxHeight + margin; // Espace entre chaque prestation
      });
    }
    
    // 2. Ensuite les prestations modifiées
    if (prestationsModifiees.length > 0) {
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(`${prestationsAjoutees.length > 0 ? '2' : '1'}. Modifications de prestations existantes (${prestationsModifiees.length})`, x, y);
      doc.font('Helvetica').fontSize(11);
      y += 20;
      
      prestationsModifiees.forEach((modif, index) => {
        // Format de la date pour information contextuelle
        const date = safeFormatDate(modif.nouveauxDetails.date);
        
        // Obtenir la liste des modifications pour cette prestation
        const changes = getModificationType(modif.anciensDetails, modif.nouveauxDetails);
        
        if (changes.length > 0) {
          // Titre de la prestation
          const titleText = `${index + 1}. Prestation du ${date} (${modif.nouveauxDetails.description})`;
          const titleWidth = 480; // Largeur disponible pour le titre
          const titleHeight = doc.heightOfString(titleText, { 
            width: titleWidth 
          });
          
          // Calculer la hauteur pour chaque changement
          let changesHeight = 0;
          
          changes.forEach(change => {
            let changeText = '';
            switch(change.type) {
              case 'description':
                changeText = `"${change.oldValue || 'Non défini'}" ${ARROW} "${change.newValue}"`;
                break;
              case 'date':
                changeText = `${change.oldValue || 'Non définie'} ${ARROW} ${change.newValue}`;
                break;
              case 'hourlyRate':
                changeText = `${change.oldValue || '0'}€/h ${ARROW} ${change.newValue}€/h`;
                break;
              case 'fixedPrice':
                changeText = `${change.oldValue || '0'}€ ${ARROW} ${change.newValue}€`;
                break;
              case 'quantity':
                changeText = `${change.oldValue || '0'} ${ARROW} ${change.newValue}`;
                break;
              case 'duration':
                const oldDuration = formatDuration({ 
                  duration: change.oldValue || 0, 
                  durationUnit: change.unit 
                });
                const newDuration = formatDuration({ 
                  duration: change.newValue || 0, 
                  durationUnit: change.unit 
                });
                changeText = `${oldDuration} ${ARROW} ${newDuration}`;
                break;
            }
            
            // Calculer la hauteur nécessaire pour ce changement
            const changeTextWidth = 350; // Largeur disponible
            const changeTextHeight = doc.heightOfString(changeText, { 
              width: changeTextWidth 
            });
            
            changesHeight += Math.max(changeTextHeight, 15); // Au moins 15 pour préserver l'espacement
          });
          
          // Hauteur totale: titre + hauteur des changements + marges
          const boxHeight = titleHeight + 10 + changesHeight + (margin * 2);
          
          // Fond léger pour chaque prestation modifiée
          doc.fillColor('#f0f4f8');
          doc.rect(x, y, 500, boxHeight).fill();
          doc.fillColor('#000000');
          
          // Ajouter en-tête pour cette prestation avec sa date
          doc.font('Helvetica-Bold').fontSize(11);
          doc.text(titleText, x + margin, y + margin, { width: titleWidth });
          doc.font('Helvetica').fontSize(11);
          
          let modifY = y + margin + titleHeight + 10;
          
          // Pour chaque changement détecté, utiliser un format tabulaire
          changes.forEach(change => {
            let label = '';
            let changeText = '';
            
            switch(change.type) {
              case 'description':
                label = "Libellé:";
                changeText = `"${change.oldValue || 'Non défini'}" ${ARROW} "${change.newValue}"`;
                break;
              case 'date':
                label = "Date:";
                changeText = `${change.oldValue || 'Non définie'} ${ARROW} ${change.newValue}`;
                break;
              case 'hourlyRate':
                label = "Taux horaire:";
                changeText = `${change.oldValue || '0'}€/h ${ARROW} ${change.newValue}€/h`;
                break;
              case 'fixedPrice':
                label = "Prix unitaire:";
                changeText = `${change.oldValue || '0'}€ ${ARROW} ${change.newValue}€`;
                break;
              case 'quantity':
                label = "Quantité:";
                changeText = `${change.oldValue || '0'} ${ARROW} ${change.newValue}`;
                break;
              case 'duration':
                label = "Durée:";
                const oldDuration = formatDuration({ 
                  duration: change.oldValue || 0, 
                  durationUnit: change.unit 
                });
                const newDuration = formatDuration({ 
                  duration: change.newValue || 0, 
                  durationUnit: change.unit 
                });
                changeText = `${oldDuration} ${ARROW} ${newDuration}`;
                break;
            }
            
            // Calculer la hauteur nécessaire pour ce changement
            const changeTextWidth = 350; // Largeur disponible
            const changeTextHeight = doc.heightOfString(changeText, { 
              width: changeTextWidth 
            });
            
            doc.text(label, x + margin * 2, modifY);
            doc.text(changeText, x + 140, modifY, { width: changeTextWidth });
            
            modifY += Math.max(changeTextHeight, 15); // Au moins 15 pour préserver l'espacement
          });
          
          y += boxHeight + margin; // Ajustement dynamique de l'espace avec marge supplémentaire
        }
      });
    }
  } else if (rectificationInfo.detailsMotif) {
    // Afficher juste le motif si pas de détails structurés
    doc.font('Helvetica-Oblique').fontSize(11);
    doc.text(rectificationInfo.detailsMotif, x + margin, y + margin);
    y += 30;
  } else {
    doc.font('Helvetica-Oblique').fontSize(11);
    doc.text("Aucun détail disponible", x + margin, y + margin);
    y += 30;
  }

  // Impact financier avec un encadré
  y += margin;
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('IMPACT FINANCIER', x, y);
  y += 20;

  // Encadré pour l'impact financier
  doc.fillColor('#e6f7ff'); // Fond bleu très clair
  doc.rect(x, y, 500, 40).fill();
  doc.fillColor('#000000');
  
  const diffHT = rectificationInfo.differenceMontantHT;
  const isPositive = diffHT >= 0;
  
  // Affichage formaté de la différence avec un texte explicatif plus complet
  doc.font(isPositive ? 'Helvetica-Bold' : 'Helvetica').fontSize(11);
  doc.fillColor(isPositive ? '#006400' : '#8b0000'); // Vert foncé ou rouge foncé
  doc.text(
    `Différence sur le montant HT : ${isPositive ? '+' : ''}${diffHT.toFixed(2)} €`,
    x + margin, y + 15, 
    { width: 480, align: 'center' }
  );
  doc.fillColor('#000000');
  
  return y + 60;
}
  

function drawRecapitulatif(doc, facture, businessInfo, x, y) {
  doc.fillColor('#f3f3f3')
    .rect(x, y, 500, businessInfo.tauxTVA ? 60 : 40)
    .fill();

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
      y + 27,
      { width: 280, align: 'right' }
    );
  }
}

function getModificationType(ancien, nouveau) {
  const modifications = [];
  
  // Vérifier les changements de description
  if (ancien.description !== nouveau.description) {
    modifications.push({
      type: 'description',
      oldValue: ancien.description,
      newValue: nouveau.description
    });
  }
  
  // Vérifier les changements de date
  if (ancien.date && nouveau.date) {
    try {
      // Tentative de création d'objets Date
      const oldDate = new Date(ancien.date);
      const newDate = new Date(nouveau.date);
      
      // Vérifier que les dates sont valides
      if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
        // Comparer les dates en vérifiant jour, mois et année
        if (
          oldDate.getDate() !== newDate.getDate() ||
          oldDate.getMonth() !== newDate.getMonth() ||
          oldDate.getFullYear() !== newDate.getFullYear()
        ) {
          modifications.push({
            type: 'date',
            oldValue: format(oldDate, 'dd/MM/yyyy', { locale: fr }),
            newValue: format(newDate, 'dd/MM/yyyy', { locale: fr })
          });
        }
      }
    } catch (error) {
      console.error('Erreur lors de la comparaison des dates:', error);
      // Ne pas ajouter de modification de date en cas d'erreur
    }
  }
  
  // Vérifier les changements selon le type de facturation
  if (ancien.billingType === 'hourly') {
    // Taux horaire
    if (ancien.hourlyRate !== nouveau.hourlyRate) {
      modifications.push({
        type: 'hourlyRate',
        oldValue: ancien.hourlyRate,
        newValue: nouveau.hourlyRate
      });
    }
    // Durée en heures
    if (ancien.duration !== nouveau.duration) {
      modifications.push({
        type: 'duration',
        oldValue: ancien.duration,
        newValue: nouveau.duration,
        unit: 'hours' // Forcer l'unité en heures pour le type horaire
      });
    }
  } else {
    // Prix forfaitaire
    if (ancien.fixedPrice !== nouveau.fixedPrice) {
      modifications.push({
        type: 'fixedPrice',
        oldValue: ancien.fixedPrice,
        newValue: nouveau.fixedPrice
      });
    }
    // Quantité
    if (ancien.quantity !== nouveau.quantity) {
      modifications.push({
        type: 'quantity',
        oldValue: ancien.quantity,
        newValue: nouveau.quantity
      });
    }
    // Durée
    if (ancien.duration !== nouveau.duration) {
      modifications.push({
        type: 'duration',
        oldValue: ancien.duration,
        newValue: nouveau.duration,
        unit: ancien.durationUnit || 'minutes'
      });
    }
  }
  
  return modifications;
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

      // Variables de positionnement
      const pageHeight = doc.page.height;
      const marginTop = 50;
      const bottomMargin = 50;
      const marginLeft = 50;
      let y = marginTop;
      const maxY = pageHeight - bottomMargin;

      // 1) Infos entreprise
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

      // 2) Infos client
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

      // 3) Numéro + Titre
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

      // 4) Intitulé
      if (businessInfo.invoiceTitle) {
        doc.font('Helvetica-Bold').fontSize(12);
        const labelX = doc.text('Intitulé : ', marginLeft, y).x;
        doc.font('Helvetica').fontSize(12);
        doc.text(businessInfo.invoiceTitle, labelX + 50, y, { width: 350, align: 'left' });
        y += 30;
      }

      // 5) Message de rectification
      if (facture.isRectification && facture.rectificationInfo) {
        doc.font('Helvetica').fontSize(11);
        const introText = `Vous trouverez ci-dessous notre correction de facture : La facture du ${format(new Date(facture.rectificationInfo.dateRectification), 'dd/MM/yyyy', { locale: fr })
          } sous le numéro ${facture.rectificationInfo.originalInvoiceNumber} est par conséquent annulée. Nous souhaitons vous renouveler toutes nos excuses et vous présentons ci-dessous la nouvelle facture effective.`;

        doc.text(introText, marginLeft, y, {
          width: 500,
          align: 'left',
          lineGap: 2
        });
        y += doc.heightOfString(introText, { width: 500, lineGap: 2 }) + 20;
      }

      // 6) Tableau des prestations
      drawTableHeader(doc, marginLeft, y);
      y += 25;

      // Ajouter les prestations
      y = addPrestations(doc, prestations, marginLeft, y, maxY, marginTop);

      // 7) Récapitulatif
      y += 30;
      if (y + 60 > maxY) {
        doc.addPage();
        y = marginTop;
      }
      drawRecapitulatif(doc, facture, businessInfo, marginLeft, y);
      y += businessInfo.tauxTVA ? 60 : 40;

      // 8) Détails de rectification et impact financier (déplacés ici)
      if (facture.isRectification && facture.rectificationInfo) {
        y += 20;
        if (y + 100 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        y = drawRectificationInfo(doc, facture.rectificationInfo, marginLeft, y);
      }

      // 9) Date d'échéance
      if (businessInfo.displayOptions?.showDueDateOnInvoice) {
        y += 40;
        if (y + 20 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        doc.font('Helvetica').fontSize(12);
        doc.text(
          `Date d'échéance : ${format(new Date(facture.dateEcheance), 'dd/MM/yyyy', { locale: fr })}`,
          marginLeft,
          y
        );
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




/*
const PDFDocument = require('pdfkit');
const { format } = require('date-fns');
const { fr } = require('date-fns/locale');
const fs = require('fs');
const path = require('path');



function formatHours(hoursDecimal) {
  let hours = Math.floor(hoursDecimal);
  let minutesDecimal = (hoursDecimal - hours) * 60;
  let minutes = Math.round(minutesDecimal);

  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  const minutesFormatted = minutes.toString().padStart(2, '0');
  if (minutes > 0) {
    return `${hours}h${minutesFormatted}`;
  } else {
    return `${hours}h`;
  }
}

function sanitizeClientName(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/\s+/g, '_');
}

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

function formatDuration(prestation) {
  if (!prestation.duration) return '';

  if (prestation.billingType === 'hourly') {
    const h = Math.floor(prestation.duration / 60);
    const m = prestation.duration % 60;
    return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
  }

  switch (prestation.durationUnit) {
    case 'minutes':
      return `${prestation.duration}min`;
    case 'hours': {
      const h = Math.floor(prestation.duration / 60);
      const m = prestation.duration % 60;
      return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
    }
    case 'days':
      return prestation.duration === 720 ? '½ journée' : '1 journée';
    default:
      return `${prestation.duration}min`;
  }
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
        },
        permissions: {
          printing: 'highResolution',
          modifying: false,
          copying: false,
          annotating: false,
          fillingForms: false,
          contentAccessibility: true,
          documentAssembly: false,
        },
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // --- Mise en page ---
      const pageHeight = doc.page.height;
      const marginTop = 50;
      const bottomMargin = 50;
      const marginLeft = 50;
      let y = marginTop;
      //const maxY = pageHeight - bottomMargin;

      // --- Si c'est une facture rectificative, ajouter un bandeau en haut ---
      if (facture.isRectification) {
        doc.fillColor('#2563eb'); // Bleu
        doc.rect(0, 0, doc.page.width, 40).fill();
        
        doc.fillColor('#ffffff');
        doc.font('Helvetica-Bold').fontSize(16);
        doc.text('FACTURE RECTIFICATIVE', 0, 12, {
          align: 'center',
          width: doc.page.width
        });

        y += 50; // Décaler le reste du contenu
      }


      // --- Info entreprise ---
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(businessInfo.name, marginLeft, y);
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.address, marginLeft, y + 20);
      doc.text(`${businessInfo.postalCode} ${businessInfo.city}`, marginLeft, y + 35);
      doc.text(`Numéro de portable : ${businessInfo.phone}`, marginLeft, y + 60);
      doc.text(`Email : ${businessInfo.email}`, marginLeft, y + 80);
      doc.text(`Siret: ${businessInfo.siret}`, marginLeft, y + 100);
      doc.text(businessInfo.companyType, marginLeft, y + 120);

      // --- Info client ---
      y += 140;
      const clientInfoX = 380;
      const clientInfoWidth = 180;
      const verticalSpacing = 10;

      doc.font('Helvetica-Bold').fontSize(12);
      const nameHeight = doc.heightOfString(client.name, {
        width: clientInfoWidth,
        align: 'left',
      });
      doc.text(client.name, clientInfoX, y, { width: clientInfoWidth, align: 'left' });

      y += nameHeight + verticalSpacing;
      doc.font('Helvetica').fontSize(12);
      const streetHeight = doc.heightOfString(client.street || '', { width: clientInfoWidth });
      doc.text(client.street || '', clientInfoX, y, { width: clientInfoWidth });

      y += streetHeight + verticalSpacing;
      const cityText = `${client.postalCode} ${client.city}`;
      const cityHeight = doc.heightOfString(cityText, { width: clientInfoWidth });
      doc.text(cityText, clientInfoX, y, { width: clientInfoWidth });

      y += cityHeight + verticalSpacing;
      const invoiceDate = facture.dateFacture ? new Date(facture.dateFacture) : new Date();
      const dateText = `Le ${format(invoiceDate, 'dd/MM/yyyy', { locale: fr })}`;
      doc.text(dateText, clientInfoX, y, { width: clientInfoWidth, align: 'left' });

      // --- Numéro de facture ---
      y += 50;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(`Facture N°${facture.invoiceNumber}`, marginLeft, y + 15);

      // --- Titre principal ---
      y += 30;
      doc.font('Helvetica-Bold').fontSize(14);
      doc.text(
        `FACTURE DU MOIS DE ${format(
          new Date(facture.year, facture.month - 1),
          'MMMM yyyy',
          { locale: fr }
        ).toUpperCase()}`,
        { align: 'center', width: 500 }
      );

      // --- Intitulé ---
      y += 40;
      doc.font('Helvetica-Bold').fontSize(12);
      const labelX = doc.text('Intitulé : ', marginLeft, y).x;
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.invoiceTitle, labelX + 50, y, { width: 350, align: 'left' });

      // --- Tableau ---
      y += 30;
      let headerHeight = drawTableHeader(doc, marginLeft, y);
      y += headerHeight;

      doc.font('Helvetica').fontSize(12);

      let isGrey = false;

      // **Paramètres de ligne**:
      const rowPaddingVertical = 10; // padding haut/bas dans la ligne
      const minimalRowHeight = 40;   // hauteur minimale

      // Prestations groupées par date
      const prestationsByDate = {};
      prestations.forEach((p) => {
        const dateKey = format(new Date(p.date), 'dd/MM/yyyy');
        if (!prestationsByDate[dateKey]) {
          prestationsByDate[dateKey] = [];
        }
        prestationsByDate[dateKey].push(p);
      });

      // Tri (du plus récent au plus ancien)
      const dateKeys = Object.keys(prestationsByDate);
      const sortedDateKeys = dateKeys.sort((b, a) => {
        const parseDate = (dateStr) => {
          const [dd, MM, yyyy] = dateStr.split('/');
          return new Date(`${yyyy}-${MM}-${dd}`);
        };
        return parseDate(b) - parseDate(a);
      });

      sortedDateKeys.forEach((date) => {
        const datePrestations = prestationsByDate[date];

        // Construit le texte
        const prestationsWidth = 280;
        const prestationsText = datePrestations.map((p) => {
          if (p.billingType === 'hourly') {
            return `${formatDuration(p)} de ${p.description}`;
          }

          const quantity = p.quantity ?? 1;
          const pluralSuffix = quantity > 1 ? 's' : '';

          if (p.durationUnit === 'days') {
            const duration = formatDuration(p);
            return `${duration} de ${p.description}`;
          } else {
            let text = `${quantity} ${p.description}${pluralSuffix}`;
            if (p.duration && p.duration > 0) {
              text += ` de ${formatDuration(p)}`;
            }
            return text;
          }
        }).join(' / ');

        // Calcule la hauteur du bloc de texte
        const prestationsHeight = doc.heightOfString(prestationsText, {
          width: prestationsWidth,
          align: 'left',
          lineGap: 2,
        });

        // Hauteur finale de la ligne : min(40) ou la hauteur + padding
        const rowHeight = Math.max(
          minimalRowHeight,
          prestationsHeight + rowPaddingVertical * 2
        );

        // Saut de page si besoin
        if (y + rowHeight > maxY) {
          doc.addPage();
          y = marginTop;
          headerHeight = drawTableHeader(doc, marginLeft, y);
          doc.font('Helvetica').fontSize(12);
          y += headerHeight;
        }

        // Fond de ligne
        const backgroundColor = isGrey ? '#f9f9f9' : '#ffffff';
        doc.fillColor(backgroundColor)
          .rect(marginLeft, y, 500, rowHeight)
          .fill();

        doc.fillColor('#000000'); // repasser le texte en noir

        // Dessin du texte
        // On ajoute rowPaddingVertical comme marge en haut
        const textY = y + rowPaddingVertical;

        doc.text(date, marginLeft + 10, textY, { width: 100 });
        doc.text(prestationsText, marginLeft + 120, textY, {
          width: prestationsWidth,
          align: 'left',
          lineGap: 2,
        });

        const totalForDate = datePrestations.reduce((sum, p) => sum + p.total, 0);
        doc.text(`${totalForDate.toFixed(2)} €`, marginLeft + 400, textY, {
          align: 'right',
        });

        // Avance y
        y += rowHeight;
        // On peut ajouter un petit espace supplémentaire (optionnel)
        // y += 5;

        isGrey = !isGrey;
      });

      // ----- Affichage du récapitulatif TVA -----
      y += 30;
      let recapBlockHeight;
      if (businessInfo.tauxTVA && businessInfo.tauxTVA > 0) {
        recapBlockHeight = 60; // trois lignes : TOTAL HT, TVA et NET À PAYER
      } else {
        recapBlockHeight = 40; // deux lignes : (éventuellement la mention + TOTAL TTC)
      }
      if (y + recapBlockHeight > maxY) {
        doc.addPage();
        y = marginTop;
      }

      doc.fillColor('#f3f3f3');
      doc.rect(marginLeft, y, 500, recapBlockHeight).fill();
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold');

      if (businessInfo.tauxTVA && businessInfo.tauxTVA > 0) {
        // TVA applicable : afficher TOTAL HT, TVA et NET À PAYER
        doc.text(`TOTAL HT : ${facture.montantHT.toFixed(2)} €`, marginLeft + 210, y + 7, { width: 280, align: 'right' });
        doc.text(`TVA (${(businessInfo.tauxTVA * 100).toFixed(1)}%) : ${facture.montantTVA.toFixed(2)} €`, marginLeft + 210, y + 27, { width: 280, align: 'right' });
        doc.text(`NET À PAYER : ${facture.montantTTC.toFixed(2)} €`, marginLeft + 210, y + 47, { width: 280, align: 'right' });
      } else {
        // Non soumis à la TVA
        // Afficher la mention uniquement si l'option showTvaComment est activée
        if (businessInfo.displayOptions && businessInfo.displayOptions.showTvaComment) {
          doc.text(`TVA non applicable - art.293B du CGI`, marginLeft + 210, y + 7, { width: 280, align: 'right' });
        }
        doc.text(`NET À PAYER : ${facture.montantHT.toFixed(2)} €`, marginLeft + 210, y + 27, { width: 280, align: 'right' });
      }
      y += recapBlockHeight;


      y += 40;
      doc.font('Helvetica').fontSize(12);


      if (businessInfo.displayOptions?.showDueDateOnInvoice) {
        if (y + 20 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        doc.text(
          `Date d'échéance : ${format(new Date(facture.dateEcheance), 'dd/MM/yyyy')}`,
          marginLeft,
          y
        );
      }

      // Écriture du fichier
      const pdfDir = path.join(__dirname, '../public/uploads/invoices');
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }

      const sanitizedClientName = sanitizeClientName(client.name);
      const fileName = `Facture_${client.name}_${format(
        new Date(facture.dateFacture),
        'MMMM_yyyy',
        { locale: fr }
      ).toLowerCase()}.pdf`;
      const filePath = path.join(pdfDir, fileName);
      const pdfPath = `uploads/invoices/${fileName}`;



      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);
      doc.end();

      writeStream.on('finish', () => resolve(pdfPath));
      writeStream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = {
  generateInvoicePDF,
  sanitizeClientName,
};
*/