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
 * Génère le PDF d'une facture et retourne le buffer du PDF.
 * @param {Object} facture - L'objet facture.
 * @param {Object} client - L'objet client.
 * @param {Object} businessInfo - Les informations de l'entreprise.
 * @param {Array} prestations - Liste des prestations.
 * @returns {Promise<Buffer>} - Le buffer du PDF généré.
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

      // Marges
      const marginLeft = 50;
      const marginTop = 50;
      let y = marginTop;

      // Info entreprise (nom en gras)
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(businessInfo.name, marginLeft, y);
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.address, marginLeft, y + 20);
      doc.text(`${businessInfo.postalCode} ${businessInfo.city}`, marginLeft, y + 35);
      doc.text(`Numéro de portable : ${businessInfo.phone}`, marginLeft, y + 60);
      doc.text(`Email : ${businessInfo.email}`, marginLeft, y + 80);
      doc.text(`Siret: ${businessInfo.siret}`, marginLeft, y + 100);
      doc.text(businessInfo.companyType, marginLeft, y + 120);

      // Info client
      y += 140;
      const clientInfoX = 380;
      const clientInfoWidth = 180;
      const verticalSpacing = 10;

      doc.font('Helvetica-Bold').fontSize(12);
      const nameHeight = doc.heightOfString(client.name, { width: clientInfoWidth, align: 'left' });
      doc.text(client.name, clientInfoX, y, { width: clientInfoWidth, align: 'left' });

      y += nameHeight + verticalSpacing;
      doc.font('Helvetica').fontSize(12);
      const streetHeight = doc.heightOfString(client.street, { width: clientInfoWidth, align: 'left' });
      doc.text(client.street, clientInfoX, y, { width: clientInfoWidth, align: 'left' });

      y += streetHeight + verticalSpacing;
      const cityText = `${client.postalCode} ${client.city}`;
      const cityHeight = doc.heightOfString(cityText, { width: clientInfoWidth, align: 'left' });
      doc.text(cityText, clientInfoX, y, { width: clientInfoWidth, align: 'left' });

      y += cityHeight + verticalSpacing;
      const invoiceDate = facture.dateFacture ? new Date(facture.dateFacture) : new Date();
      const dateText = `Le ${format(invoiceDate, 'dd/MM/yyyy', { locale: fr })}`;
      doc.text(dateText, clientInfoX, y, { width: clientInfoWidth, align: 'left' });

      // Numéro de facture
      y += 50;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(`Facture N°${facture.invoiceNumber}`, marginLeft, y + 15);

      // Titre principal (centré)
      y += 30;
      doc.font('Helvetica-Bold').fontSize(14);
      doc.text(`FACTURE DU MOIS DE ${format(new Date(facture.year, facture.month - 1), 'MMMM yyyy', { locale: fr }).toUpperCase()}`, {
        align: 'center',
        width: 500
      });

      // Intitulé
      y += 40;
      doc.font('Helvetica-Bold').fontSize(12);
      const intituleX = doc.text('Intitulé : ', marginLeft, y).x;
      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.invoiceTitle, intituleX + 50, y, { width: 350, align: 'left' });

      // En-tête du tableau
      y += 30;
      doc.fillColor('#f3f3f3');
      doc.rect(marginLeft, y, 500, 25).fill();
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('Date', marginLeft + 10, y + 7);
      doc.text('Prestations', marginLeft + 120, y + 7);
      doc.text('Tarifs (€)', marginLeft + 445, y + 7);

      // Contenu du tableau
      y += 25;
      doc.font('Helvetica').fontSize(12);
      let isGrey = false;

      // Regrouper les prestations par date
      const prestationsByDate = {};
      prestations.forEach(prestation => {
        const dateKey = format(new Date(prestation.date), 'dd/MM/yyyy');
        if (!prestationsByDate[dateKey]) {
          prestationsByDate[dateKey] = [];
        }
        prestationsByDate[dateKey].push(prestation);
      });

      // Récupérer les clés de dates et les trier **du plus récent au plus ancien**
      const dateKeys = Object.keys(prestationsByDate);
      const sortedDateKeys = dateKeys.sort((b, a) => {
        // Conversion du format "dd/MM/yyyy" en "yyyy-MM-dd" pour un tri correct
        const parseDate = (dateStr) => {
          const [dd, MM, yyyy] = dateStr.split('/');
          return new Date(`${yyyy}-${MM}-${dd}`);
        };
        return parseDate(b) - parseDate(a);
      });

      // Affichage des lignes du tableau
      sortedDateKeys.forEach((date) => {
        const datePrestations = prestationsByDate[date];
        const prestationsText = datePrestations
          .map(p => `${formatHours(p.hours)} de ${p.description}`)
          .join(' / ');

        const prestationsWidth = 280;
        const prestationsHeight = doc.heightOfString(prestationsText, {
          width: prestationsWidth,
          align: 'left'
        });

        const rowHeight = Math.max(30, prestationsHeight + 10);

        if (isGrey) {
          doc.fillColor('#f9f9f9');
          doc.rect(marginLeft, y, 500, rowHeight).fill();
          doc.fillColor('#000000');
        }

        doc.text(date, marginLeft + 10, y + 10, { width: 100, align: 'left' });
        doc.text(prestationsText, marginLeft + 120, y + 10, {
          width: prestationsWidth,
          align: 'left',
          lineGap: 2
        });
        const totalForDate = datePrestations.reduce((sum, p) => sum + p.total, 0);
        doc.text(`${totalForDate.toFixed(2)} €`, marginLeft + 400, y + 10, {
          align: 'right'
        });
        y += rowHeight;
        isGrey = !isGrey;
      });

      // Total général
      y += 10;
      const total = prestations.reduce((sum, p) => sum + p.total, 0);
      doc.fillColor('#f3f3f3');
      doc.rect(marginLeft, y, 500, 25).fill();
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold');
      doc.text('TOTAL :', marginLeft + 120, y + 7, { width: 280, align: 'left' });
      doc.text(`${total.toFixed(2)} €`, marginLeft + 400, y + 7, { align: 'right' });

      // Mentions finales
      y += 40;
      doc.font('Helvetica').fontSize(12);

      // Affichage de la mention TVA uniquement si l'option est activée
      if (businessInfo.displayOptions && businessInfo.displayOptions.showTvaComment) {
        doc.text('TVA non applicable - art.293B du CGI', marginLeft, y);
        y += 20; // Incrémentez y pour laisser un espace après la mention
      }

      if (businessInfo.displayOptions?.showDueDateOnInvoice) {
        doc.text(`Date d'échéance : ${format(new Date(facture.dateEcheance), 'dd/MM/yyyy')}`, marginLeft, y);
      }

      // Sauvegarde du PDF
      const pdfDir = path.join(__dirname, '../public/uploads/invoices');
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }

      const sanitizedClientName = sanitizeClientName(client.name);
      const fileName = `Facture_${client.name}_${format(new Date(facture.dateFacture), 'MMMM_yyyy', { locale: fr }).toLowerCase()}.pdf`;
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

