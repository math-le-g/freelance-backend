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

const generateInvoicePDF = async (facture, client, businessInfo, prestations, diffMap = {}) => {
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
      const maxY = pageHeight - bottomMargin;

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

function formatDuration(duration, durationUnit, billingType) {
  if (!duration) return '';
  
  if (billingType === 'hourly') {
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    return minutes > 0 ? `${hours}h${minutes.toString().padStart(2, '0')}` : `${hours}h`;
  }
  
  switch(durationUnit) {
    case 'minutes':
      return `${duration}min`;
      
    case 'hours': {
      const h = Math.floor(duration / 60);
      const m = duration % 60;
      return m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`;
    }
    
    case 'days': {
      const days = duration / 1440;
      return days === 0.5 ? '½ journée' : '1 journée';
    }
    
    default:
      return `${duration}min`;
  }
}

const generateInvoicePDF = async (facture, client, businessInfo, prestations, diffMap = {} ) => {
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
      const maxY = pageHeight - bottomMargin;

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
        const prestationsText = datePrestations
  .map((p) => {
    const duration = formatDuration(p.duration, p.durationUnit, p.billingType);
    
    if (p.billingType === 'hourly') {
      return `${duration} de ${p.description}`;
    } else {
      const quantity = p.quantity ?? 1;
      const pluralSuffix = quantity > 1 ? 's' : '';
      
      if (p.durationUnit === 'days') {
        return `${duration} de ${p.description}`;
      } else {
        let text = `${quantity} ${p.description}${pluralSuffix}`;
        if (p.duration) {
          text += ` de ${duration}`;
        }
        return text;
      }
    }
  })
  .join(' / ');

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

      // Espace avant total
      y += 30;
      if (y + 25 > maxY) {
        doc.addPage();
        y = marginTop;
      }

      // Total global
      const total = prestations.reduce((sum, p) => sum + p.total, 0);
      doc.fillColor('#f3f3f3');
      doc.rect(marginLeft, y, 500, 25).fill();
      doc.fillColor('#000000');

      doc.font('Helvetica-Bold');
      doc.text('TOTAL :', marginLeft + 120, y + 7, { width: 280, align: 'left' });
      doc.text(`${total.toFixed(2)} €`, marginLeft + 400, y + 7, { align: 'right' });

      y += 40;
      doc.font('Helvetica').fontSize(12);

      // Mentions finales
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