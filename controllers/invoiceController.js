const PDFDocument = require('pdfkit');
const { format } = require('date-fns');
const { fr } = require('date-fns/locale');
const fs = require('fs');
const path = require('path');

/**
 * Formate les heures en format "XhYY".
 * @param {number} hoursDecimal - Les heures en décimal.
 * @returns {string} - Les heures formatées.
 */
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

/**
 * Sanitize le nom du client pour l'utilisation dans le nom du fichier PDF.
 * @param {string} name - Le nom du client.
 * @returns {string} - Le nom sanitizé.
 */
function sanitizeClientName(name) {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Dessine l'en-tête du tableau (colonnes) à la position y spécifiée,
 * en mettant en gras les intitulés.
 * @param {PDFDocument} doc - L'instance PDFKit.
 * @param {number} x - Position X de départ.
 * @param {number} y - Position Y de départ.
 */
function drawTableHeader(doc, x, y) {
  const headerHeight = 25;
  doc.fillColor('#f3f3f3');
  doc.rect(x, y, 500, headerHeight).fill();
  doc.fillColor('#000000');

  // On rend le texte en gras
  doc.font('Helvetica-Bold').fontSize(12);

  doc.text('Date', x + 10, y + 7);
  doc.text('Prestations', x + 120, y + 7);
  doc.text('Tarifs (€)', x + 445, y + 7);

  return headerHeight;
}

/**
 * Génère le PDF d'une facture et retourne le chemin du PDF généré (ou un buffer).
 * @param {Object} facture - L'objet facture.
 * @param {Object} client - L'objet client.
 * @param {Object} businessInfo - Les informations de l'entreprise.
 * @param {Array} prestations - Liste des prestations.
 * @returns {Promise<Buffer|string>} - Le chemin du PDF ou le buffer du PDF.
 */
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
          documentAssembly: false
        }
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData); 
      });

      // --- Variables de mise en page ---
      const pageHeight = doc.page.height;   // Hauteur de la page
      const marginTop = 50;                // Marge haute
      const bottomMargin = 50;             // Marge basse
      const marginLeft = 50;               // Marge gauche
      let y = marginTop;                   // Position Y courante
      const maxY = pageHeight - bottomMargin;

      // --- Infos de l'entreprise ---
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(businessInfo.name, marginLeft, y);
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.address, marginLeft, y + 20);
      doc.text(`${businessInfo.postalCode} ${businessInfo.city}`, marginLeft, y + 35);
      doc.text(`Numéro de portable : ${businessInfo.phone}`, marginLeft, y + 60);
      doc.text(`Email : ${businessInfo.email}`, marginLeft, y + 80);
      doc.text(`Siret: ${businessInfo.siret}`, marginLeft, y + 100);
      doc.text(businessInfo.companyType, marginLeft, y + 120);

      // --- Infos du client ---
      y += 140;
      const clientInfoX = 380;
      const clientInfoWidth = 180;
      const verticalSpacing = 10;

      doc.font('Helvetica-Bold').fontSize(12);
      const nameHeight = doc.heightOfString(client.name, { width: clientInfoWidth, align: 'left' });
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

      // --- Titre principal (centré) ---
      y += 30;
      doc.font('Helvetica-Bold').fontSize(14);
      doc.text(
        `FACTURE DU MOIS DE ${format(new Date(facture.year, facture.month - 1), 'MMMM yyyy', {
          locale: fr
        }).toUpperCase()}`,
        { align: 'center', width: 500 }
      );

      // --- Intitulé ---
      y += 40;
      doc.font('Helvetica-Bold').fontSize(12);
      const labelX = doc.text('Intitulé : ', marginLeft, y).x;
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.invoiceTitle, labelX + 50, y, { width: 350, align: 'left' });

      // --- Préparation du tableau ---
      y += 30;
      // On dessine l'en-tête du tableau et on avance y
      let headerHeight = drawTableHeader(doc, marginLeft, y);
      y += headerHeight;

      // Police standard pour le contenu du tableau
      doc.font('Helvetica').fontSize(12);

      // Pour l'alternance des lignes
      let isGrey = false;

      // Regrouper les prestations par date
      const prestationsByDate = {};
      prestations.forEach((prestation) => {
        const dateKey = format(new Date(prestation.date), 'dd/MM/yyyy');
        if (!prestationsByDate[dateKey]) {
          prestationsByDate[dateKey] = [];
        }
        prestationsByDate[dateKey].push(prestation);
      });

      // Tri des dates (du plus récent au plus ancien)
      const dateKeys = Object.keys(prestationsByDate);
      const sortedDateKeys = dateKeys.sort((b, a) => {
        // Convertir "dd/MM/yyyy" en "yyyy-MM-dd"
        const parseDate = (dateStr) => {
          const [dd, MM, yyyy] = dateStr.split('/');
          return new Date(`${yyyy}-${MM}-${dd}`);
        };
        return parseDate(b) - parseDate(a);
      });

      // --- Boucle sur chaque date ---
      sortedDateKeys.forEach((date) => {
        const datePrestations = prestationsByDate[date];

        // Construire la description jointe
        const prestationsText = datePrestations
          .map((p) => {
            if (p.billingType === 'hourly') {
              // Ex: "2h30 de Massage"
              const duration = formatHours(p.hours);
              return `${duration} de ${p.description}`;
            } else {
              // Forfait ou daily
              const quantity = p.quantity ?? 1;
              const pluralSuffix = quantity > 1 ? 's' : '';
              const baseWord = p.description + pluralSuffix;

              let durationStr = '';
              const totalMin = p.duration || 0;

              if (p.durationUnit === 'minutes') {
                durationStr = `${totalMin}min`;
              } else if (p.durationUnit === 'hours') {
                const h = Math.floor(totalMin / 60);
                const m = totalMin % 60;
                if (m === 0) {
                  durationStr = `${h}h`;
                } else {
                  durationStr = `${h}h${m}min`;
                }
              } else if (p.durationUnit === 'days') {
                const nbDays = totalMin / (24 * 60);
                if (Number.isInteger(nbDays)) {
                  durationStr = nbDays === 1 ? '1 jour' : `${nbDays} jours`;
                } else {
                  durationStr = `${nbDays} jours`;
                }
              }

              if (p.durationUnit === 'days') {
                // ex: "2 jours de développement"
                if (durationStr) {
                  return `${durationStr} de ${p.description}`;
                } else {
                  return p.description;
                }
              } else {
                // minutes / hours => "2 massages de 80min" etc.
                let description = `${quantity} ${baseWord}`;
                if (durationStr) {
                  description += ` de ${durationStr}`;
                }
                return description;
              }
            }
          })
          .join(' / ');

        // Calcul de la hauteur nécessaire
        const prestationsWidth = 280;
        const prestationsHeight = doc.heightOfString(prestationsText, {
          width: prestationsWidth,
          align: 'left',
        });
        // On prévoit au moins 30px, ou la hauteur du texte + 10
        const rowHeight = Math.max(30, prestationsHeight + 10);

        // --- Vérifier si on dépasse la limite de la page ---
        if (y + rowHeight > maxY) {
          // On ajoute une page
          doc.addPage();
          // Réinitialiser y
          y = marginTop;
          // Redessiner l'en-tête du tableau
          headerHeight = drawTableHeader(doc, marginLeft, y);
          doc.font('Helvetica').fontSize(12);
          y += headerHeight;
        }

        // Alternance de fond (gris/blanc)
        if (isGrey) {
          doc.fillColor('#f9f9f9');
          doc.rect(marginLeft, y, 500, rowHeight).fill();
          doc.fillColor('#000000');
        }

        // Affichage du texte
        doc.text(date, marginLeft + 10, y + 10, { width: 100 });
        doc.text(prestationsText, marginLeft + 120, y + 10, {
          width: prestationsWidth,
          align: 'left',
          lineGap: 2,
        });

        const totalForDate = datePrestations.reduce((sum, p) => sum + p.total, 0);
        doc.text(`${totalForDate.toFixed(2)} €`, marginLeft + 400, y + 10, {
          align: 'right',
        });

        // On avance le curseur y
        y += rowHeight;
        isGrey = !isGrey;
      });

      // --- Ajouter un écart vertical avant le total ---
      y += 30; // ← Espace supplémentaire

      // --- Total général ---
      if (y + 25 > maxY) {
        doc.addPage();
        y = marginTop;
      }

      const total = prestations.reduce((sum, p) => sum + p.total, 0);
      doc.fillColor('#f3f3f3');
      doc.rect(marginLeft, y, 500, 25).fill();
      doc.fillColor('#000000');

      // Titre en gras
      doc.font('Helvetica-Bold');
      doc.text('TOTAL :', marginLeft + 120, y + 7, { width: 280, align: 'left' });
      doc.text(`${total.toFixed(2)} €`, marginLeft + 400, y + 7, { align: 'right' });

      y += 40;
      doc.font('Helvetica').fontSize(12);

      // --- Mentions finales ---
      if (businessInfo.displayOptions && businessInfo.displayOptions.showTvaComment) {
        if (y + 20 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        doc.text('TVA non applicable - art.293B du CGI', marginLeft, y);
        y += 20;
      }

      if (businessInfo.displayOptions?.showDueDateOnInvoice) {
        if (y + 20 > maxY) {
          doc.addPage();
          y = marginTop;
        }
        doc.text(`Date d'échéance : ${format(new Date(facture.dateEcheance), 'dd/MM/yyyy')}`, marginLeft, y);
      }

      // --- Sauvegarde du PDF ---
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

