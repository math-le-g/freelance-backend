
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { startOfMonth, endOfMonth } = require('date-fns');
const { format } = require('date-fns'); // Import de format
const Facture = require('../models/Facture');
const Prestation = require('../models/Prestation');
const Client = require('../models/Client');
const BusinessInfo = require('../models/BusinessInfo');
const { generateInvoicePDF, sanitizeClientName } = require('../controllers/invoiceController'); // Import centralisé


const { body, validationResult } = require('express-validator');



/**
 * Route POST pour la prévisualisation d'une facture
 * URL: /api/factures/preview
 */

router.post('/preview', [
  body('clientId').isMongoId().withMessage('clientId invalide.'),
  body('year').isInt({ min: 1900 }).withMessage('Année invalide.'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Mois invalide.')
], async (req, res) => {
  try {
    const userId = req.user._id;
    const { clientId, year, month } = req.body;
    const dateFacture = new Date();

    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) return res.status(404).json({ message: 'Client non trouvé.' });

    // Dates de début et fin du mois
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const prestations = await Prestation.find({
      user: userId,
      client: clientId,
      date: { $gte: startDate, $lte: endDate }
    });

    if (!prestations.length) {
      return res.status(404).json({ message: 'Aucune prestation trouvée.' });
    }

    const businessInfo = await BusinessInfo.findOne({ user: userId });
    const montantHT = prestations.reduce((sum, p) => sum + p.total, 0);
    const taxRate = businessInfo.taxeURSSAF || 0.246;
    const taxeURSSAF = parseFloat((montantHT * taxRate).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));

    // Calcul TVA et TTC
    const tauxTVA = businessInfo.tauxTVA || 0.20;
    const montantTVA = parseFloat((montantHT * tauxTVA).toFixed(2));
    const montantTTC = parseFloat((montantHT + montantTVA).toFixed(2));

    const nextInvoiceNumber = await getNextInvoiceNumber(userId);
    const dateEcheance = new Date(dateFacture);
    dateEcheance.setDate(dateEcheance.getDate() + 30);

    const factureTemp = {
      dateFacture,
      dateEcheance,
      prestations,
      montantHT,
      taxeURSSAF,
      montantNet,
      montantTVA,   // ajouté
      montantTTC,   // ajouté
      invoiceNumber: nextInvoiceNumber,
      year: parseInt(year),
      month: parseInt(month),
    };

    const pdfBuffer = await generateInvoicePDF(factureTemp, client, businessInfo, prestations);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': 'inline; filename=preview.pdf'
    });
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Erreur prévisualisation:', error);
    res.status(500).json({ message: error.message });
  }
});

// Fonction utilitaire pour obtenir le prochain numéro de facture
async function getNextInvoiceNumber(userId) {
  const lastInvoice = await Facture.findOne({ user: userId })
    .sort({ invoiceNumber: -1 });
  return (lastInvoice?.invoiceNumber || 0) + 1;
}


/**
 * Route POST pour créer une facture
 * URL: /api/factures/
 */
router.post('/', [
  body('clientId').isMongoId().withMessage('clientId invalide.'),
  body('year').isInt({ min: 1900 }).withMessage('Année invalide.'),
  body('month').isInt({ min: 1, max: 12 }).withMessage('Mois invalide.')
], async (req, res) => {
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { clientId, year, month } = req.body;

    console.log('Données reçues pour création de facture:', { clientId, year, month });

    // Conversion et validation des données
    const parsedYear = parseInt(year, 10);
    const parsedMonth = parseInt(month, 10);

    // Vérification du client
    const client = await Client.findOne({ _id: clientId, user: userId }).session(session);
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Client non trouvé ou non autorisé.' });
    }

    // Vérification d'une facture existante
    const existingFacture = await Facture.findOne({
      user: userId,
      client: clientId,
      year: parsedYear,
      month: parsedMonth,
    }).session(session);

    if (existingFacture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: 'Une facture pour ce client et ce mois existe déjà.'
      });
    }

    // Création de la date de facture : on utilise la date actuelle
    const dateFacture = new Date();

    // Création des dates de début et fin du mois
    const startDate = startOfMonth(new Date(parsedYear, parsedMonth - 1, 1));
    const endDate = endOfMonth(new Date(parsedYear, parsedMonth - 1, 1));

    // Récupération des prestations
    const prestations = await Prestation.find({
      user: userId,
      client: clientId,
      date: {
        $gte: startDate,
        $lte: endDate,
      },
    }).session(session);

    if (prestations.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: 'Aucune prestation trouvée pour ce client et ce mois.'
      });
    }


    // Récupérer les informations de l'entreprise
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    if (!businessInfo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: 'Paramètres de facturation non trouvés.'
      });
    }


    // Calculs financiers
    const montantHT = prestations.reduce((acc, p) => acc + p.total, 0);
    const taxRate = businessInfo.taxeURSSAF || 0.246;
    const taxeURSSAF = parseFloat((montantHT * taxRate).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));
    const tauxTVA = businessInfo.tauxTVA || 0.20;
    const montantTVA = parseFloat((montantHT * tauxTVA).toFixed(2));
    const montantTTC = parseFloat((montantHT + montantTVA).toFixed(2));
    const nombreHeures = prestations.reduce((acc, p) => acc + p.hours, 0);



    // Détermination du numéro de facture
    const lastInvoice = await Facture.findOne({ user: userId }).sort({ invoiceNumber: -1 }).session(session);
    let nextInvoiceNumber = businessInfo.invoiceNumberStart || 1;

    if (lastInvoice) {
      nextInvoiceNumber = Math.max(
        businessInfo.invoiceNumberStart,
        lastInvoice.invoiceNumber + 1
      );
    }

    // Calcul de la date d'échéance basée sur dateFacture et paymentDelay
    const paymentDelay = businessInfo.features?.invoiceStatus?.paymentDelay || 30;
    const dateEcheance = new Date(dateFacture);
    dateEcheance.setDate(dateEcheance.getDate() + paymentDelay);

    // Création de la facture
    const facture = new Facture({
      user: userId,
      client: clientId,
      prestations: prestations.map(p => p._id),
      montantHT,
      taxeURSSAF,
      montantNet,
      montantTVA,
      montantTTC,
      nombreHeures,
      invoiceNumber: nextInvoiceNumber,
      year: parsedYear,
      month: parsedMonth,
      dateFacture,
      dateEcheance,
      status: 'unpaid'
    });

    // Générer le PDF
    const pdfBuffer = await generateInvoicePDF(facture, client, businessInfo, prestations);

    // Sauvegarder le PDF dans le dossier uploads/invoices
    const pdfDir = path.join(__dirname, '../public/uploads/invoices');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const sanitizedClientName = sanitizeClientName(client.name);
    const fileName = `Facture_${sanitizedClientName}_${format(new Date(facture.dateFacture), 'MM_yyyy')}_${facture.invoiceNumber}_${Date.now()}.pdf`;
    const filePath = path.join(pdfDir, fileName);
    const pdfPath = `uploads/invoices/${fileName}`;

    fs.writeFileSync(filePath, pdfBuffer);

    // Définir pdfPath directement
    facture.pdfPath = pdfPath;

    // Sauvegarder la facture
    await facture.save({ session });

    // Mise à jour des prestations pour les lier à la facture
    await Prestation.updateMany(
      { _id: { $in: prestations.map(p => p._id) } },
      {
        $set: {
          invoiceId: facture._id,
          // On ne met pas invoicePaid à true ici car la facture vient d'être créée
        }
      },
      { session }
    );


    // Mise à jour du numéro de facture dans BusinessInfo
    businessInfo.currentInvoiceNumber = nextInvoiceNumber;
    await businessInfo.save({ session });

    // Commit de la transaction
    await session.commitTransaction();
    session.endSession();

    res.status(201).json(facture);

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors de la création de la facture:', error);
    res.status(500).json({
      message: 'Erreur lors de la création de la facture',
      error: error.message
    });
  }
});

/**
 * Route GET pour obtenir les factures
 * URL: /api/factures/
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const { year, month, clientId, status } = req.query;
    const query = { user: userId };

    if (year) query.year = parseInt(year, 10);
    if (month) query.month = parseInt(month, 10);
    if (clientId) query.client = clientId;
    if (status) query.status = status;

    const factures = await Facture.find(query)
      .populate('client')
      .sort({ year: -1, month: -1, invoiceNumber: -1 });

    res.json(factures);
  } catch (error) {
    console.error('Erreur GET /factures:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Route GET pour obtenir le dernier numéro de facture
 * URL: /api/factures/last-number
 */
router.get('/last-number', async (req, res) => {
  try {
    const userId = req.user._id;
    const lastInvoice = await Facture.findOne({ user: userId }).sort({ invoiceNumber: -1 });

    const lastInvoiceNumber = lastInvoice ? lastInvoice.invoiceNumber : 0;
    res.json({ lastInvoiceNumber });
  } catch (error) {
    console.error('Erreur GET /factures/last-number:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * Route GET pour une facture spécifique
 * URL: /api/factures/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    const facture = await Facture.findOne({ _id: factureId, user: userId })
      .populate('client')
      .populate('prestations');

    if (!facture) {
      return res.status(404).json({ message: 'Facture non trouvée' });
    }

    res.json(facture);
  } catch (error) {
    console.error('Erreur GET /factures/:id:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * Route DELETE pour supprimer une facture
 * URL: /api/factures/:id
 */
router.delete('/:id', async (req, res) => {

  const session = await mongoose.startSession();
  session.startTransaction();


  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    // Trouver la facture et vérifier qu'elle appartient à l'utilisateur
    const facture = await Facture.findOne({ _id: factureId, user: userId }).session(session);;
    if (!facture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture non trouvée ou non autorisée.' });
    }

    // Réinitialiser les prestations associées
    await Prestation.updateMany(
      { invoiceId: factureId },
      {
        $set: {
          invoiceId: null,
          invoicePaid: false
        }
      },
      { session }
    );

    // Supprimer le fichier PDF associé si existant
    if (facture.pdfPath) {
      const pdfFullPath = path.join(__dirname, '../public', facture.pdfPath);
      if (fs.existsSync(pdfFullPath)) {
        fs.unlinkSync(pdfFullPath);
        console.log(`PDF supprimé : ${pdfFullPath}`);
      }
    }

    // Supprimer la facture
    await Facture.deleteOne({ _id: factureId }).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({ message: 'Facture supprimée avec succès.' });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors de la suppression de la facture:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la suppression de la facture.' });
  }
});



/**
 * Route GET pour télécharger ou visualiser le PDF d'une facture
 * URL: /api/factures/:id/pdf
 */

router.get('/:id/pdf', async (req, res) => {
  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    const facture = await Facture.findOne({ _id: factureId, user: userId })
      .populate('client')
      .populate('prestations');

    if (!facture) {
      return res.status(404).json({ message: 'Facture non trouvée.' });
    }

    const client = await Client.findById(facture.client);
    const businessInfo = await BusinessInfo.findOne({ user: userId });

    const pdfBuffer = await generateInvoicePDF(facture, client, businessInfo, facture.prestations);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': 'inline; filename=facture.pdf'
    });
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Erreur PDF:', error);
    res.status(500).json({ message: error.message });
  }
});



/**
 * Route POST pour marquer une facture comme payée
 * URL: /api/factures/:id/paiement
 */
router.post('/:id/paiement', [
  body('methodePaiement').isString().withMessage('Méthode de paiement est requise.'),
  body('commentaire').optional().isString()
], async (req, res) => {
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const { methodePaiement, commentaire } = req.body;
    const userId = req.user._id;
    const factureId = req.params.id;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    const facture = await Facture.findOne({ _id: factureId, user: userId });

    if (!facture) {
      return res.status(404).json({ message: 'Facture non trouvée.' });
    }

    // Vérifier le statut de la facture
    if (facture.status === 'paid') {
      return res.status(400).json({ message: 'La facture est déjà payée.' });
    }

    // Marquer comme payée
    facture.status = 'paid';
    facture.datePaiement = new Date();
    facture.methodePaiement = methodePaiement;
    facture.commentairePaiement = commentaire;

    facture.historiquePaiements.push({
      date: facture.datePaiement,
      montant: facture.montantHT,
      methode: methodePaiement,
      commentaire: commentaire
    });

    // Marquer toutes les prestations associées comme payées
    await Prestation.updateMany(
      {
        invoiceId: factureId,
        // Ajout d'une condition pour s'assurer que les prestations appartiennent à l'utilisateur
        user: userId
      },
      {
        $set: {
          invoicePaid: true,
          // On s'assure que l'invoiceId est bien défini
          invoiceId: factureId
        }
      }
    );

    await facture.save();

    // Récupérer la facture avec les prestations mises à jour
    const updatedFacture = await Facture.findById(factureId)
      .populate('client')
      .populate('prestations');

    res.json({
      message: 'Paiement enregistré avec succès.',
      facture: updatedFacture,
      success: true
    });
  } catch (error) {
    console.error('Erreur lors du paiement de la facture:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de l\'enregistrement du paiement.',
      success: false
    });
  }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.post('/:id/rectify', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { modifiedInvoice, reason } = req.body;
    const userId = req.user._id;

    const facture = await Facture.findOne({ _id: id, user: userId }).session(session);
    if (!facture) throw new Error('Facture non trouvée');
    if (facture.status === 'paid') throw new Error('Impossible de rectifier une facture payée');

    // Récupérer businessInfo AVANT de l'utiliser dans les calculs
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    if (!businessInfo) throw new Error('Paramètres de facturation non trouvés.');

    facture.versions.push({
      date: new Date(),
      client: facture.client,
      dateFacture: facture.dateFacture,
      montantHT: facture.montantHT,
      taxeURSSAF: facture.taxeURSSAF,
      montantNet: facture.montantNet,
      montantTTC: facture.montantTTC,
      nombreHeures: facture.nombreHeures,
      changesComment: reason || 'Rectification sans motif'
    });

    const updatedPrestations = [];
    for (const prestation of modifiedInvoice.prestations) {
      let updatedPrestation;
      let prestationData = {
        description: prestation.description,
        billingType: prestation.billingType,
        date: prestation.date,
        duration: prestation.duration,
        durationUnit: prestation.durationUnit || 'minutes',
        total: prestation.total,
        quantity: prestation.quantity || 1
      };

      if (prestation.billingType === 'hourly') {
        prestationData.hours = prestation.hours;
        prestationData.hourlyRate = prestation.hourlyRate;
        prestationData.durationUnit = 'hours';
      } else {
        prestationData.fixedPrice = prestation.fixedPrice;
      }

      if (prestation._id.startsWith('temp-')) {
        updatedPrestation = await Prestation.create([{
          ...prestationData,
          user: userId,
          client: facture.client,
          invoiceId: facture._id
        }], { session });
        updatedPrestation = updatedPrestation[0];
      } else {
        updatedPrestation = await Prestation.findByIdAndUpdate(
          prestation._id,
          prestationData,
          { session, new: true }
        );
      }

      updatedPrestations.push(updatedPrestation);
    }

    facture.prestations = updatedPrestations.map(p => p._id);
    const montantHT = updatedPrestations.reduce((sum, p) => sum + p.total, 0);
    const taxRate = businessInfo.taxeURSSAF || 0.246;
    const taxeURSSAF = parseFloat((montantHT * taxRate).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));

    facture.montantHT = montantHT;
    facture.taxeURSSAF = taxeURSSAF;
    facture.montantNet = montantNet;
    facture.montantTTC = montantNet;
    facture.nombreHeures = updatedPrestations.reduce((sum, p) => sum + (p.duration || 0) / 60, 0);

    await facture.save({ session });

    const client = await Client.findById(facture.client);
    // businessInfo a déjà été défini ci-dessus, on l'utilise pour générer le PDF
    const pdfBuffer = await generateInvoicePDF(facture, client, businessInfo, updatedPrestations);

    await session.commitTransaction();
    res.json({ ...facture.toObject(), prestations: updatedPrestations });

  } catch (error) {
    await session.abortTransaction();
    console.error('Erreur rectification:', error);
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;


















