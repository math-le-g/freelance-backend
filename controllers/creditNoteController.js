const PDFDocument = require('pdfkit');
const { format } = require('date-fns');
const { fr } = require('date-fns/locale');

/**
 * Génère un PDF d'avoir avec une mise en page professionnelle
 * en respectant le positionnement demandé
 */
async function generateCreditNotePDF(facture, client, businessInfo) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        pdfVersion: '1.7',
        info: {
          Title: `Avoir_${facture.avoir?.numero || 'A000'}`,
          Author: businessInfo.name,
          Subject: `Avoir pour ${client.name}`,
          Keywords: 'avoir, credit note',
        }
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // -----------------------------
      // Variables de position
      // -----------------------------
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const marginLeft = 50;
      const marginTop = 50;
      const bottomMargin = 50;
      let y = marginTop; // départ vertical
      const contentWidth = pageWidth - marginLeft * 2;
      const maxY = pageHeight - bottomMargin;

      // =========================
      // 1) Entreprise (à gauche)
      // =========================
      doc.fillColor('#000000')
         .font('Helvetica-Bold').fontSize(12)
         .text(businessInfo.name, marginLeft, y);
      y += 20;

      doc.font('Helvetica').fontSize(12);
      doc.text(businessInfo.address, marginLeft, y);
      y += 20;

      doc.text(`${businessInfo.postalCode} ${businessInfo.city}`, marginLeft, y);
      y += 25;

      doc.text(`Numéro de portable : ${businessInfo.phone}`, marginLeft, y);
      y += 20;

      doc.text(`Email : ${businessInfo.email}`, marginLeft, y);
      y += 20;

      doc.text(`Siret : ${businessInfo.siret}`, marginLeft, y);
      y += 20;

      doc.text(businessInfo.companyType, marginLeft, y);
      
      // On calcule la hauteur finale du bloc entreprise
      const entrepriseEndY = y + 20;

      // =========================
      // 2) Client (à droite, mais commençant à mi-chemin des infos entreprise)
      // =========================
      const clientInfoX = 400;  // Position horizontale des infos client
      const clientInfoWidth = 150;
      
      // Position verticale des infos client (commençant à mi-chemin des infos entreprise)
      // En se basant sur la capture d'écran, les infos client commencent à peu près au milieu du bloc entreprise
      let clientY = marginTop + 80;  // Ajustez cette valeur pour positionner correctement
      clientY += 60;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(client.name, clientInfoX, clientY, { width: clientInfoWidth });
      clientY += 20;

      doc.font('Helvetica').fontSize(12);
      if (client.street) {
        doc.text(client.street, clientInfoX, clientY, { width: clientInfoWidth });
        clientY += 20;
      }
      
      doc.text(`${client.postalCode} ${client.city}`, clientInfoX, clientY, { width: clientInfoWidth });
      clientY += 20;

      // Date d'émission de l'avoir
      if (facture.avoir?.date) {
        const dateAvoir = format(new Date(facture.avoir.date), 'dd/MM/yyyy', { locale: fr });
        doc.text(`Le ${dateAvoir}`, clientInfoX, clientY, { width: clientInfoWidth });
      }

      // =========================
      // 3) Numéro d'avoir et référence facture
      // =========================
      
      // On prend le plus grand Y entre la fin du bloc entreprise et la fin du bloc client
      y = Math.max(entrepriseEndY, clientY + 30) + 20;
      
      // Numéro d'avoir (à gauche)
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text(`Avoir N°${facture.avoir?.numero || 'A000'}`, marginLeft, y);
      
      // Référence facture - alignée à droite
      doc.font('Helvetica').fontSize(11);
      doc.text(`Ref: Facture N°${facture.invoiceNumber}`, clientInfoX, y, { width: clientInfoWidth });
      
      y += 25;

      // =========================
      // 4) Ligne de séparation élégante
      // =========================
      doc.strokeColor('#cccccc')
         .lineWidth(0.5)
         .moveTo(marginLeft, y)
         .lineTo(marginLeft + 500, y)
         .stroke();
         
      y += 30;

      // =========================
      // 5) Motif de l'avoir
      // =========================
      doc.font('Helvetica-Bold').fontSize(12);
      const motif = facture.avoir?.motif || 'Aucun motif spécifié';
      
      // Titre
      doc.fillColor('#333333')
         .text('Motif de l\'avoir:', marginLeft, y);
      y += 20;
      
      // Contenu du motif
      doc.font('Helvetica').fontSize(12)
         .fillColor('#000000')
         .text(motif, marginLeft, y, { width: 500 });
      
      const motifHeight = doc.heightOfString(motif, { width: 500 });
      y += motifHeight + 30;

      // =========================
      // 6) Tableau "Date / Description / Montant"
      // =========================
      const tableStartY = y;
      const headerHeight = 30;
      const tableWidth = 500;
      
      // En-tête du tableau
      doc.fillColor('#f6f9fc')
         .rect(marginLeft, tableStartY, tableWidth, headerHeight)
         .fill();
      
      // Bordure du tableau
      doc.lineWidth(0.5)
         .strokeColor('#cccccc')
         .rect(marginLeft, tableStartY, tableWidth, headerHeight + 40)
         .stroke();
      
      doc.fillColor('#444444')
         .font('Helvetica-Bold').fontSize(12);

      // Titres des colonnes
      doc.text('Date', marginLeft + 20, tableStartY + 10);
      doc.text('Description', marginLeft + 150, tableStartY + 10);
      doc.text('Montant', marginLeft + 400, tableStartY + 10);

      // Ligne de séparation après l'en-tête
      doc.strokeColor('#cccccc')
         .lineWidth(0.5)
         .moveTo(marginLeft, tableStartY + headerHeight)
         .lineTo(marginLeft + tableWidth, tableStartY + headerHeight)
         .stroke();

      // Ligne de données
      const rowHeight = 40;
      const dataY = tableStartY + headerHeight + 15;

      doc.font('Helvetica').fontSize(12).fillColor('#000000');
      
      // Colonne Date
      if (facture.avoir?.date) {
        const dateTxt = format(new Date(facture.avoir.date), 'dd/MM/yyyy', { locale: fr });
        doc.text(dateTxt, marginLeft + 20, dataY);
      }

      // Colonne Description
      doc.text('Remboursement partiel', marginLeft + 150, dataY);

      // Colonne Montant - montant négatif
      const amount = facture.avoir?.montant ? `-${facture.avoir.montant.toFixed(2)} €` : '-0.00 €';
      doc.fillColor('#d73232') // Rouge pour montant négatif
         .text(amount, marginLeft + 400, dataY);

      y = tableStartY + headerHeight + rowHeight + 20;

      // =========================
      // 7) Total encadré
      // =========================
      doc.fillColor('#f6f9fc')
         .rect(marginLeft + 300, y, 200, 40)
         .fill();
      
      doc.lineWidth(0.5)
         .strokeColor('#cccccc')
         .rect(marginLeft + 300, y, 200, 40)
         .stroke();

      doc.fillColor('#000000')
         .font('Helvetica-Bold').fontSize(12)
         .text('TOTAL À DÉDUIRE :', marginLeft + 310, y + 14);
         
      doc.fillColor('#d73232')
         .text(`${facture.avoir?.montant.toFixed(2)} €`, marginLeft + 450, y + 14, { align: 'right' });

      y += 60;

      // =========================
      // 8) Remboursement / Mode de déduction
      // =========================
      if (facture.avoir?.remboursement) {
        doc.fillColor('#000000')
           .font('Helvetica-Bold').fontSize(12)
           .text('REMBOURSEMENT', marginLeft, y);
           
        y += 20;
        
        doc.font('Helvetica').fontSize(11);
        
        const method = facture.avoir.methodePaiement || 'N/A';
        doc.text(`Mode de remboursement : ${method}`, marginLeft, y);
        y += 20;

        if (facture.avoir.dateRemboursement) {
          const dateRemb = format(new Date(facture.avoir.dateRemboursement), 'dd/MM/yyyy', { locale: fr });
          doc.text(`Date de remboursement : ${dateRemb}`, marginLeft, y);
          y += 20;
        }
      } else {
        doc.fillColor('#000000')
           .font('Helvetica-Bold').fontSize(12)
           .text('INFORMATION', marginLeft, y);
           
        y += 20;
        
        doc.font('Helvetica').fontSize(11);
        doc.text('Cet avoir sera déduit sur une prochaine facture.', marginLeft, y);
        y += 20;
      }

      y += 25;

      // =========================
      // 9) Note et mentions légales
      // =========================
      doc.fillColor('#666666')
   .font('Helvetica-Oblique').fontSize(10)
   .text(
     'Ce document justifie une rectification de facturation. Il doit être conservé avec',
     marginLeft,
     y
   )
   .text(
     `la facture N°${facture.invoiceNumber} comme pièce comptable.`,
     marginLeft,
     y + 15
   );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateCreditNotePDF };