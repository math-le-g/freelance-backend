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
const { generateCreditNotePDF } = require('../controllers/creditNoteController');
const prestationRouter = require('./prestationRoutes');
const { updatePrestationsWithInvoiceInfo } = prestationRouter;



const { body, validationResult } = require('express-validator');

const validatePrestation = (p) => {
  if (!p.date || !p.description) return false;
  if (p.billingType === 'hourly') {
    return typeof p.hours === 'number' &&
      typeof p.hourlyRate === 'number' &&
      typeof p.duration === 'number';
  }
  if (p.billingType === 'fixed') {
    return typeof p.fixedPrice === 'number' &&
      typeof p.quantity === 'number' &&
      typeof p.duration === 'number';
  }
  return false;
};



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
    const montantHT = prestations.reduce((acc, p) => {
      // Multiplier par la quantité pour les prestations de type forfait
      const quantity = (p.billingType === 'fixed' && p.quantity) ? p.quantity : 1;
      return acc + (p.total * quantity);
    }, 0);
    const taxRate = businessInfo.taxeURSSAF || 0.246;
    const taxeURSSAF = parseFloat((montantHT * taxRate).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));
    const tauxTVA = businessInfo.tauxTVA || 0.20;
    const montantTVA = parseFloat((montantHT * tauxTVA).toFixed(2));
    const montantTTC = parseFloat((montantHT + montantTVA).toFixed(2));
    const nombreHeures = prestations.reduce((acc, p) => {
      // Si prestation horaire avec champ hours défini
      if (p.billingType === 'hourly' && typeof p.hours === 'number') {
        return acc + p.hours;
      }
      // Si la prestation a une durée, la convertir en heures selon l'unité
      else if (typeof p.duration === 'number') {
        if (p.durationUnit === 'hours' || p.billingType === 'hourly') {
          return acc + (p.duration / 60); // Minutes -> heures
        }
        else if (p.durationUnit === 'days') {
          return acc + (p.duration / 60 / 24); // Minutes -> jours
        }
        else {
          return acc + (p.duration / 60); // Par défaut, suppose minutes -> heures
        }
      }
      // Fallback par défaut
      return acc;
    }, 0);



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
      status: 'draft',
      isSentToClient: false,
      locked: false,
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
          invoiceStatus: 'draft',
          invoiceIsSentToClient: false,
          invoiceLocked: false
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
    const facture = await Facture.findOne({ _id: factureId, user: userId }).session(session);
    if (!facture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture non trouvée ou non autorisée.' });
    }

    // Empêcher la suppression si locked, rectifiée, ou rectificative
    if (facture.locked || facture.statut === 'RECTIFIEE' || facture.isRectification) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: 'Impossible de supprimer cette facture (rectificative / rectifiée / verrouillée).'
      });
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
        user: userId
      },
      {
        $set: {
          invoicePaid: true,
          invoiceId: factureId,
          invoiceStatus: 'paid'
        }
      }
    );

    // Ou utilisez le helper:
    //await updatePrestationsWithInvoiceInfo(factureId);


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

    if (facture.locked) {
      return res.status(400).json({ message: 'Cette facture est verrouillée et ne peut plus être modifiée.' });
    }

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


//////////////////////////////////////////////////////////////////////////////////////////////////////////


// ======================
// Route POST /api/factures/:id/rectify-new
// ======================
router.post('/:id/rectify-new', async (req, res) => {
  const { id } = req.params;
  const { motifLegal, detailsMotif, prestations } = req.body;
  const userId = req.user._id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!motifLegal) throw new Error('Le motif légal est requis');
    if (!prestations || !Array.isArray(prestations) || prestations.length === 0) {
      throw new Error('Les prestations sont requises et doivent être un tableau non vide');
    }

    // 1) Charger la facture originale
    const originalFacture = await Facture.findOne({ _id: id, user: userId })
      .populate('prestations')
      .populate('client')
      .session(session);
    if (!originalFacture) throw new Error('Facture originale non trouvée');
    if (originalFacture.status === 'paid') {
      throw new Error('Cette facture ne peut pas être rectifiée (déjà payée)');
    }

    // 2) Charger businessInfo, client, etc.
    const client = originalFacture.client; // déjà populate
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    if (!businessInfo) throw new Error('Informations de facturation introuvables');

    // 3) On va construire:
    // - nouvellesPrestations => la liste finale qui ira dans la facture rectificative
    // - prestationsModifiees => la liste d'objets { type: "MODIFIEE" | "AJOUTEE" | "SUPPRIMEE", ... }
    let nouvellesPrestations = [];
    let prestationsModifiees = [];
    let montantHTTotal = 0;

    // Pour repérer les prestations qu'on a vraiment conservées (MODIFIEES ou AJOUTEES)
    const newIds = new Set(); // tous les _id qu'on garde
    for (const p of prestations) {
      if (p._id && !p._id.startsWith('temp-')) {
        newIds.add(p._id.toString());
      }
    }

    // === A) Parcourir chaque prestation transmise dans la rectification
    for (const p of prestations) {
      let newPrestation;
      if (p._id && !p._id.startsWith('temp-')) {
        // => Prestation existante => "MODIFIEE"
        // On cherche la prestation originale
        const oldPrestation = await Prestation.findById(p._id).session(session);
        if (!oldPrestation) {
          throw new Error(`Prestation introuvable en base (_id=${p._id})`);
        }

        // Construire la "nouvelle" copie
        const newData = {
          user: userId,
          client: client._id,
          billingType: p.billingType ?? oldPrestation.billingType,
          description: p.description ?? oldPrestation.description,
          hours: p.billingType === 'hourly'
            ? (p.hours ?? oldPrestation.hours)
            : undefined,
          hourlyRate: p.billingType === 'hourly'
            ? (p.hourlyRate ?? oldPrestation.hourlyRate)
            : undefined,
          fixedPrice: p.billingType === 'fixed'
            ? (p.fixedPrice ?? oldPrestation.fixedPrice)
            : undefined,
          quantity: p.billingType === 'fixed'
            ? (p.quantity ?? oldPrestation.quantity)
            : undefined,
          duration: p.duration ?? oldPrestation.duration,
          durationUnit: p.durationUnit ?? oldPrestation.durationUnit,
          date: p.date ?? oldPrestation.date,
          total: p.total ?? oldPrestation.total,
          invoiceId: null,
          originalPrestationId: oldPrestation._id
        };

        // Créer la nouvelle Prestation
        newPrestation = (await Prestation.create([newData], { session }))[0];

        // Marquer l'ancienne comme remplacée
        await Prestation.findByIdAndUpdate(oldPrestation._id, {
          isReplaced: true,
          replacedByPrestationId: newPrestation._id
        }, { session });

        prestationsModifiees.push({
          prestationId: oldPrestation._id,
          type: 'MODIFIEE',
          anciensDetails: {
            description: oldPrestation.description,
            billingType: oldPrestation.billingType,
            hours: oldPrestation.hours,
            hourlyRate: oldPrestation.hourlyRate,
            fixedPrice: oldPrestation.fixedPrice,
            duration: oldPrestation.duration,
            durationUnit: oldPrestation.durationUnit,
            total: oldPrestation.total,
            date: oldPrestation.date,
            quantity: oldPrestation.quantity
          },
          nouveauxDetails: {
            ...newData,
            _id: newPrestation._id
          }
        });
      } else {
        // => Prestation nouvelle => "AJOUTEE"
        const newData = {
          user: userId,
          client: client._id,
          billingType: p.billingType,
          description: p.description,
          hours: p.billingType === 'hourly' ? (p.hours || 0) : undefined,
          hourlyRate: p.billingType === 'hourly' ? (p.hourlyRate || 0) : undefined,
          fixedPrice: p.billingType === 'fixed' ? (p.fixedPrice || 0) : undefined,
          quantity: p.billingType === 'fixed' ? (p.quantity || 1) : undefined,
          duration: p.duration || 0,
          durationUnit: p.durationUnit || 'minutes',
          date: p.date || new Date(),
          total: p.total || 0,
          invoiceId: null
        };

        newPrestation = (await Prestation.create([newData], { session }))[0];

        prestationsModifiees.push({
          prestationId: newPrestation._id,
          type: 'AJOUTEE',
          nouveauxDetails: {
            ...newData,
            _id: newPrestation._id
          }
        });
      }

      nouvellesPrestations.push(newPrestation);
      montantHTTotal += newPrestation.total;
    }

    // === B) Repérer les prestations SUPPRIMÉES
    //    (celles de la facture originale non présentes dans newIds)
    const originalIds = originalFacture.prestations.map((op) => op._id.toString());
    for (const origId of originalIds) {
      if (!newIds.has(origId)) {
        // => On a supprimé cette prestation
        const oldP = await Prestation.findById(origId).session(session);
        if (oldP) {
          prestationsModifiees.push({
            prestationId: oldP._id,
            type: 'SUPPRIMEE',
            anciensDetails: {
              description: oldP.description,
              billingType: oldP.billingType,
              hours: oldP.hours,
              hourlyRate: oldP.hourlyRate,
              fixedPrice: oldP.fixedPrice,
              duration: oldP.duration,
              durationUnit: oldP.durationUnit,
              total: oldP.total,
              date: oldP.date,
              quantity: oldP.quantity
            }
          });
        }
      }
    }

    // 5) Calcul du nouveau total
    const taxRate = businessInfo.taxeURSSAF || 0.246;
    const tauxTVA = businessInfo.tauxTVA || 0;
    const taxeURSSAF = parseFloat((montantHTTotal * taxRate).toFixed(2));
    const montantNet = parseFloat((montantHTTotal - taxeURSSAF).toFixed(2));
    const montantTVA = parseFloat((montantHTTotal * tauxTVA).toFixed(2));
    const montantTTC = parseFloat((montantHTTotal + montantTVA).toFixed(2));

    // 6) Préparation des données de la nouvelle facture
    let rectificationChain = [];
    if (originalFacture.isRectification && originalFacture.rectificationInfo?.rectificationChain) {
      rectificationChain = [...originalFacture.rectificationInfo.rectificationChain];
    }
    rectificationChain.push(originalFacture._id);

    const rectificationData = {
      user: userId,
      client: client._id,
      dateFacture: new Date(),
      prestations: nouvellesPrestations.map((np) => np._id),
      montantHT: montantHTTotal,
      taxeURSSAF,
      montantNet,
      montantTVA,
      montantTTC,
      invoiceNumber: await getNextInvoiceNumber(userId),
      year: originalFacture.year,
      month: originalFacture.month,
      dateEcheance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isRectification: true,
      rectificationInfo: {
        originalFactureId: originalFacture._id,
        originalInvoiceNumber: originalFacture.invoiceNumber,
        rectificationChain,
        motifLegal,
        detailsMotif: detailsMotif || motifLegal,
        dateRectification: originalFacture.dateFacture,
        prestationsModifiees,
        differenceMontantHT: parseFloat((montantHTTotal - originalFacture.montantHT).toFixed(2)),
        differenceTaxeURSSAF: parseFloat((taxeURSSAF - originalFacture.taxeURSSAF).toFixed(2)),
        differenceMontantNet: parseFloat((montantNet - originalFacture.montantNet).toFixed(2)),
        differenceMontantTTC: parseFloat((montantTTC - originalFacture.montantTTC).toFixed(2))
      }
    };

    // 7) Créer la facture rectificative
    const [nouvelleFacture] = await Facture.create([rectificationData], { session });

    // 8) Verrouiller la facture originale
    await Prestation.updateMany(
      { invoiceId: originalFacture._id },
      { $set: { invoiceStatus: 'RECTIFIEE', invoiceLocked: true } },
      { session }
    );
    await Facture.findByIdAndUpdate(
      originalFacture._id,
      {
        statut: 'RECTIFIEE',
        locked: true,
        $push: {
          rectifications: {
            factureId: nouvelleFacture._id,
            date: new Date(),
            motifLegal,
            detailsMotif
          }
        }
      },
      { session }
    );

    // 9) Générer le PDF
    const pdfBuffer = await generateInvoicePDF(nouvelleFacture, client, businessInfo, nouvellesPrestations);

    // 10) Sauvegarder le PDF
    const pdfDir = path.join(__dirname, '../public/uploads/invoices');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }
    const fileName = `Facture_${sanitizeClientName(client.name)}_Rectificative_${nouvelleFacture.invoiceNumber}_${Date.now()}.pdf`;
    const filePath = path.join(pdfDir, fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    nouvelleFacture.pdfPath = `uploads/invoices/${fileName}`;
    await nouvelleFacture.save({ session });

    // 11) Mettre à jour le numéro de facture dans BusinessInfo
    businessInfo.currentInvoiceNumber = rectificationData.invoiceNumber;
    await businessInfo.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Facture rectificative créée avec succès',
      facture: nouvelleFacture
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur création facture rectificative:', error);
    res.status(500).json({
      message: 'Erreur lors de la création de la facture rectificative',
      error: error.message
    });
  } finally {
    session.endSession();
  }
});


/*
router.post('/:id/rectify-new', async (req, res) => {
  // Définition immédiate de "id"
  const { id } = req.params;
  console.log('Démarrage rectification:', {
    factureId: id,
    motifLegal: req.body.motifLegal,
    prestationsCount: req.body.prestations?.length
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { motifLegal, detailsMotif, prestations } = req.body;
    const userId = req.user._id;

    // 1. Vérifications initiales
    if (!motifLegal) {
      throw new Error('Le motif légal est requis');
    }
    if (!prestations || !Array.isArray(prestations) || prestations.length === 0) {
      throw new Error('Les prestations sont requises et doivent être un tableau non vide');
    }

    // 2. Récupérer la facture originale avec ses prestations et client
    const originalFacture = await Facture.findOne({ _id: id, user: userId })
      .populate('prestations')
      .populate('client')
      .session(session);
    if (!originalFacture) {
      throw new Error('Facture originale non trouvée');
    }
    if (originalFacture.status === 'paid') {
      throw new Error('Cette facture ne peut pas être rectifiée');
    }
    console.log('Facture originale:', {
      id: originalFacture._id,
      invoiceNumber: originalFacture.invoiceNumber,
      montantHT: originalFacture.montantHT
    });

    // 3. Récupérer le client et les informations d'entreprise
    const client = await Client.findById(originalFacture.client._id).session(session);
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    if (!businessInfo) {
      throw new Error('Informations de facturation non trouvées');
    }

    // 4. Traitement des prestations modifiées ou ajoutées
    const prestationsModifiees = []; // Pour l'historique des modifications
    const nouvellesPrestations = []; // Prestations à rattacher à la nouvelle facture
    let montantHTTotal = 0;

    for (const p of prestations) {
      let newPrestation;
      if (p._id && !p._id.startsWith('temp-')) {
        // Ne pas modifier la prestation originale, mais créer une copie modifiée
        const prestationOriginale = await Prestation.findById(p._id).session(session);
        if (!prestationOriginale) {
          throw new Error(`Prestation avec l'ID ${p._id} non trouvée`);
        }

        // Construire les données pour la nouvelle prestation basée sur l'originale
        const nouvellePrestationData = {
          user: userId,
          client: client._id,
          description: p.description !== undefined ? p.description : prestationOriginale.description,
          billingType: p.billingType !== undefined ? p.billingType : prestationOriginale.billingType,
          // Pour le cas horaire
          hours: p.billingType === 'hourly' ? (p.hours !== undefined ? p.hours : prestationOriginale.hours) : undefined,
          hourlyRate: p.billingType === 'hourly' ? (p.hourlyRate !== undefined ? p.hourlyRate : prestationOriginale.hourlyRate) : undefined,
          // Pour le forfait
          fixedPrice: p.billingType === 'fixed' ? (p.fixedPrice !== undefined ? p.fixedPrice : prestationOriginale.fixedPrice) : undefined,
          quantity: p.billingType === 'fixed' ? (p.quantity !== undefined ? p.quantity : prestationOriginale.quantity) : undefined,
          // Champs communs
          duration: p.duration !== undefined ? p.duration : prestationOriginale.duration,
          durationUnit: p.durationUnit || prestationOriginale.durationUnit,
          date: p.date !== undefined ? p.date : prestationOriginale.date,
          total: p.total !== undefined ? p.total : prestationOriginale.total,
          // Créer une nouvelle prestation, pas liée à la facture originale
          invoiceId: null,
          // Nouvelles propriétés pour la gestion des rectifications
          originalPrestationId: prestationOriginale._id
        };

        // Créer une NOUVELLE prestation au lieu de modifier l'originale
        newPrestation = (await Prestation.create([nouvellePrestationData], { session }))[0];

        // Marquer la prestation originale comme remplacée
        await Prestation.findByIdAndUpdate(
          prestationOriginale._id,
          {
            isReplaced: true,
            replacedByPrestationId: newPrestation._id
          },
          { session }
        );

        prestationsModifiees.push({
          prestationId: prestationOriginale._id,
          type: 'MODIFIEE',
          anciensDetails: {
            description: prestationOriginale.description,
            billingType: prestationOriginale.billingType,
            hours: prestationOriginale.hours,
            hourlyRate: prestationOriginale.hourlyRate,
            fixedPrice: prestationOriginale.fixedPrice,
            duration: prestationOriginale.duration,
            durationUnit: prestationOriginale.durationUnit,
            total: prestationOriginale.total,
            date: prestationOriginale.date,
            quantity: prestationOriginale.quantity
          },
          nouveauxDetails: {
            ...nouvellePrestationData,
            _id: newPrestation._id
          }
        });
      } else {
        // Nouvelle prestation (code inchangé)

        newPrestation = (await Prestation.create([{
          user: userId,
          client: client._id,
          date: p.date,
          description: p.description,
          billingType: p.billingType,
          hours: p.billingType === 'hourly' ? p.hours || 0 : undefined,
          hourlyRate: p.billingType === 'hourly' ? p.hourlyRate || 0 : undefined,
          fixedPrice: p.billingType === 'fixed' ? p.fixedPrice || 0 : undefined,
          quantity: p.billingType === 'fixed' ? p.quantity || 1 : undefined,
          duration: p.duration || 0,
          durationUnit: p.durationUnit || 'minutes',
          total: p.total || 0,
          invoiceId: null,
          // Pas de originalPrestationId pour une nouvelle prestation
        }], { session }))[0];
        prestationsModifiees.push({
          prestationId: newPrestation._id,
          type: 'AJOUTEE',
          nouveauxDetails: {
            description: newPrestation.description,
            billingType: newPrestation.billingType,
            hours: newPrestation.hours,
            hourlyRate: newPrestation.hourlyRate,
            fixedPrice: newPrestation.fixedPrice,
            duration: newPrestation.duration,
            durationUnit: newPrestation.durationUnit,
            total: newPrestation.total,
            date: newPrestation.date,
            quantity: newPrestation.quantity
          }
        });
      }
      nouvellesPrestations.push(newPrestation);
      montantHTTotal += newPrestation.total;
    }

    // 5. Calcul des nouveaux montants
    const taxRate = businessInfo.taxeURSSAF || 0.246;
    const tauxTVA = businessInfo.tauxTVA || 0;
    const taxeURSSAF = parseFloat((montantHTTotal * taxRate).toFixed(2));
    const montantNet = parseFloat((montantHTTotal - taxeURSSAF).toFixed(2));
    const montantTVA = parseFloat((montantHTTotal * tauxTVA).toFixed(2));
    const montantTTC = parseFloat((montantHTTotal + montantTVA).toFixed(2));

    // 6. Création de la nouvelle facture rectificative

    let rectificationChain = [];

    if (originalFacture.isRectification && originalFacture.rectificationInfo.rectificationChain) {
      rectificationChain = [...originalFacture.rectificationInfo.rectificationChain];
    }

    rectificationChain.push(originalFacture._id);


    const rectificationData = {
      user: userId,
      client: client._id,
      dateFacture: new Date(),
      prestations: nouvellesPrestations.map(p => p._id),
      montantHT: montantHTTotal,
      taxeURSSAF,
      montantNet,
      montantTVA,
      montantTTC,
      invoiceNumber: await getNextInvoiceNumber(userId),
      year: originalFacture.year,
      month: originalFacture.month,
      dateEcheance: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)),
      isRectification: true,
      rectificationInfo: {
        originalFactureId: originalFacture._id,
        originalInvoiceNumber: originalFacture.invoiceNumber,
        rectificationChain,
        motifLegal,
        detailsMotif: detailsMotif || motifLegal,
        dateRectification: originalFacture.dateFacture,
        prestationsModifiees,
        differenceMontantHT: parseFloat((montantHTTotal - originalFacture.montantHT).toFixed(2)),
        differenceTaxeURSSAF: parseFloat((taxeURSSAF - originalFacture.taxeURSSAF).toFixed(2)),
        differenceMontantNet: parseFloat((montantNet - originalFacture.montantNet).toFixed(2)),
        differenceMontantTTC: parseFloat((montantTTC - originalFacture.montantTTC).toFixed(2))
      }
    };

    console.log('Données de rectification:', {
      originalInvoiceNumber: rectificationData.rectificationInfo.originalInvoiceNumber,
      differenceMontantHT: rectificationData.rectificationInfo.differenceMontantHT
    });

    const nouvelleFacture = await Facture.create([rectificationData], { session });

    // 7. Mise à jour de la facture originale : marquer comme RECTIFIEE et verrouiller
    await Prestation.updateMany(
      { invoiceId: originalFacture._id },
      {
        $set: {
          invoiceStatus: 'RECTIFIEE',
          invoiceLocked: true
        }
      },
      { session }
    );

    // Mise à jour de la facture originale : marquer comme RECTIFIEE et verrouiller
    // En utilisant findByIdAndUpdate pour éviter tout effet de bord
    await Facture.findByIdAndUpdate(
      originalFacture._id,
      {
        $set: {
          statut: 'RECTIFIEE',
          locked: true
        },
        $push: {
          rectifications: {
            factureId: nouvelleFacture[0]._id,
            date: new Date(),
            motifLegal,
            detailsMotif
          }
        }
      },
      { session }
    );

    // 8. Génération du PDF de la nouvelle facture
    const pdfBuffer = await generateInvoicePDF(nouvelleFacture[0], client, businessInfo, nouvellesPrestations);

    // 9. Sauvegarde du PDF sur le serveur
    const pdfDir = path.join(__dirname, '../public/uploads/invoices');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }
    const fileName = `Facture_${sanitizeClientName(client.name)}_Rectificative_${nouvelleFacture[0].invoiceNumber}_${Date.now()}.pdf`;
    const filePath = path.join(pdfDir, fileName);
    const pdfPath = `uploads/invoices/${fileName}`;
    fs.writeFileSync(filePath, pdfBuffer);
    nouvelleFacture[0].pdfPath = pdfPath;
    await nouvelleFacture[0].save({ session });

    // 10. Mise à jour du numéro de facture dans BusinessInfo (optionnel)
    businessInfo.currentInvoiceNumber = rectificationData.invoiceNumber;
    await businessInfo.save({ session });

    // 11. Commit de la transaction et fin de la session
    await session.commitTransaction();
    session.endSession();

    console.log('Rectification terminée avec succès:', {
      nouvelleFactureId: nouvelleFacture[0]._id,
      nouvelleFactureNumber: nouvelleFacture[0].invoiceNumber
    });

    res.status(201).json({
      message: 'Facture rectificative créée avec succès',
      facture: nouvelleFacture[0]
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Erreur création facture rectificative:', error);
    res.status(500).json({
      message: 'Erreur lors de la création de la facture rectificative',
      error: error.message
    });
  } finally {
    session.endSession();
  }
});
*/



////////////////////////////////////////////////////////////////////////////////////////////////


/**
 * Route GET pour obtenir les rectifications d'une facture
 * URL: /api/factures/:id/rectifications
 */
router.get('/:id/rectifications', async (req, res) => {
  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    // Vérification que la facture existe et appartient à l'utilisateur
    const facture = await Facture.findOne({ _id: factureId, user: userId })
      .populate('client');

    if (!facture) {
      return res.status(404).json({ message: 'Facture non trouvée.' });
    }

    // Si c'est une facture rectificative, on récupère l'originale
    if (facture.isRectification && facture.rectificationInfo?.originalFactureId) {
      const originalFacture = await Facture.findOne({
        _id: facture.rectificationInfo.originalFactureId,
        user: userId
      })
        .populate('client')
        .select('invoiceNumber dateFacture montantHT status'); // Sélectionner uniquement les champs nécessaires

      if (!originalFacture) {
        return res.status(404).json({ message: 'Facture originale non trouvée.' });
      }

      return res.json({
        type: 'rectificative',
        originalFacture: {
          id: originalFacture._id,
          numero: originalFacture.invoiceNumber,
          date: originalFacture.dateFacture,
          montant: originalFacture.montantHT,
          status: originalFacture.status,
          client: originalFacture.client
        }
      });
    }

    // Si c'est une facture originale, on récupère ses rectifications
    const rectifications = await Facture.find({
      'rectificationInfo.originalFactureId': factureId,
      user: userId,
      isRectification: true
    })
      .sort({ dateFacture: 1 })
      .populate('client')
      .select('invoiceNumber dateFacture montantHT rectificationInfo');

    return res.json({
      type: 'originale',
      rectifications: rectifications.map(rect => ({
        id: rect._id,
        numero: rect.invoiceNumber,
        date: rect.dateFacture,
        montant: rect.montantHT,
        difference: rect.rectificationInfo.differenceMontantHT,
        motif: rect.rectificationInfo.detailsMotif,
        client: rect.client
      }))
    });

  } catch (error) {
    console.error('Erreur route rectifications:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});
///////////////////////////////////////////////////////////////////////////////////////////////////

/* Route GET pour obtenir les relations d'une facture (rectifications ou original)
 * URL: /api/factures/:id/relations
 */
router.get('/:id/relations', async (req, res) => {
  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    const facture = await Facture.findOne({ _id: factureId, user: userId });
    if (!facture) {
      return res.status(404).json({ message: 'Facture non trouvée.' });
    }

    const result = {
      factureType: facture.isRectification ? 'rectificative' : 'originale',
      currentInvoiceNumber: facture.invoiceNumber,
      relations: []
    };

    // Si c'est une facture rectificative, récupérer l'originale
    if (facture.isRectification && facture.rectificationInfo?.originalFactureId) {
      const originalFacture = await Facture.findOne({
        _id: facture.rectificationInfo.originalFactureId,
        user: userId
      })
        .populate('client')
        .select('invoiceNumber dateFacture client status');

      if (originalFacture) {
        result.relations.push({
          type: 'original',
          factureId: originalFacture._id,
          invoiceNumber: originalFacture.invoiceNumber,
          dateFacture: originalFacture.dateFacture,
          client: originalFacture.client,
          status: originalFacture.status
        });
      }

      // Ajouter la chaîne de rectifications si elle existe
      if (facture.rectificationInfo.rectificationChain &&
        facture.rectificationInfo.rectificationChain.length > 0) {
        result.rectificationChain = facture.rectificationInfo.rectificationChain;
      }
      
      // Ajouter les prestations modifiées si elles existent
      if (facture.rectificationInfo.prestationsModifiees &&
        facture.rectificationInfo.prestationsModifiees.length > 0) {
        result.prestationsModifiees = facture.rectificationInfo.prestationsModifiees;
      }
    }

    // Si c'est une facture originale, récupérer toutes ses rectifications
    else {
      const rectifications = await Facture.find({
        'rectificationInfo.originalFactureId': factureId,
        user: userId,
        isRectification: true
      })
        .sort({ dateFacture: 1 })
        .populate('client')
        .select('invoiceNumber dateFacture client status rectificationInfo');

      result.relations = rectifications.map(rect => ({
        type: 'rectification',
        factureId: rect._id,
        invoiceNumber: rect.invoiceNumber,
        dateFacture: rect.dateFacture,
        client: rect.client,
        status: rect.status,
        difference: rect.rectificationInfo.differenceMontantHT,
        motif: rect.rectificationInfo.detailsMotif,
        prestationsModifiees: rect.rectificationInfo.prestationsModifiees
      }));
    }

    res.json(result);
  } catch (error) {
    console.error('Erreur récupération relations facture:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

//////////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Route POST pour annuler une facture
 * URL: /api/factures/:id/cancel
 */
router.post('/:id/cancel', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const factureId = req.params.id;
    const { motif, commentaire } = req.body;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    // Trouver la facture et vérifier qu'elle appartient à l'utilisateur
    const facture = await Facture.findOne({ _id: factureId, user: userId }).session(session);
    if (!facture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture non trouvée ou non autorisée.' });
    }

    // Vérifier si la facture peut être annulée
    if (facture.status === 'paid') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: 'Une facture payée ne peut pas être annulée. Créez plutôt un avoir.'
      });
    }

    if (facture.locked) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: 'Cette facture est verrouillée et ne peut pas être annulée.'
      });
    }

    // Si c'est une facture rectificative
    if (facture.isRectification) {
      // Vérifier s'il y a des rectifications plus récentes
      const newerRectifications = await Facture.findOne({
        'rectificationInfo.rectificationChain': { $elemMatch: { $eq: facture._id } },
        user: userId
      }).session(session);

      if (newerRectifications) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          message: 'Cette facture a des rectifications plus récentes qui doivent être annulées d\'abord.'
        });
      }
    }

    // Marquer les prestations comme non facturées
    await Prestation.updateMany(
      { invoiceId: factureId },
      {
        $set: {
          invoiceStatus: 'cancelled',
          invoiceLocked: true
        }
      },
      { session }
    );

    // Mettre à jour la facture
    facture.status = 'cancelled';
    facture.locked = true;
    facture.annulation = {
      date: new Date(),
      motif,
      commentaire,
      userId
    };

    // Si c'est une facture rectificative, mettre à jour la facture originale
    if (facture.isRectification && facture.rectificationInfo?.originalFactureId) {
      const factureOriginale = await Facture.findById(facture.rectificationInfo.originalFactureId).session(session);
      if (factureOriginale) {
        // Déverrouiller la facture originale si elle a été rectifiée et n'a plus de rectifications actives
        const autresRectifications = await Facture.findOne({
          'rectificationInfo.originalFactureId': factureOriginale._id,
          _id: { $ne: facture._id }, // Exclure la facture qu'on annule
          status: { $ne: 'cancelled' } // Exclure les factures annulées
        }).session(session);

        if (!autresRectifications) {
          factureOriginale.statut = 'VALIDE'; // Remettre à VALIDE au lieu de RECTIFIEE
          factureOriginale.locked = false;
          await factureOriginale.save({ session });
        }
      }
    }

    await facture.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: 'Facture annulée avec succès.',
      success: true
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors de l\'annulation de la facture:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de l\'annulation de la facture.',
      success: false
    });
  }
});

/**
 * Route POST pour créer un avoir (pour les factures payées)
 * URL: /api/factures/:id/credit-note
 */
router.post('/:id/credit-note', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const factureId = req.params.id;
    const { motif, montant, remboursement, methodePaiement } = req.body;

    // Vérifications de base
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    if (!motif || !montant || isNaN(parseFloat(montant)) || parseFloat(montant) <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Motif et montant valides requis pour créer un avoir.' });
    }

    // Trouver la facture et vérifier qu'elle appartient à l'utilisateur
    const facture = await Facture.findOne({ _id: factureId, user: userId }).session(session);
    if (!facture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture non trouvée ou non autorisée.' });
    }

    // Vérifier si la facture est payée
    if (facture.status !== 'paid') {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: 'Un avoir ne peut être créé que pour une facture payée.'
      });
    }

    // Vérifier si la facture a déjà un avoir valide (avec numéro ET montant)
    if (facture.avoir && facture.avoir.numero && facture.avoir.montant) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: 'Cette facture a déjà fait l\'objet d\'un avoir.'
      });
    }

    // Générer un numéro d'avoir
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    let numeroAvoir = `A-${facture.invoiceNumber}`;
    if (businessInfo && businessInfo.prefixeAvoir) {
      numeroAvoir = `${businessInfo.prefixeAvoir}-${facture.invoiceNumber}`;
    }

    // Mettre à jour la facture avec l'avoir
    facture.avoir = {
      date: new Date(),
      numero: numeroAvoir,
      montant: parseFloat(montant),
      motif,
      remboursement: remboursement === true,
      methodePaiement: remboursement ? methodePaiement : null
    };

    if (remboursement) {
      facture.avoir.dateRemboursement = new Date();
    }

    facture.status = 'paid';
    await facture.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      message: 'Avoir créé avec succès.',
      success: true,
      avoir: {
        numero: numeroAvoir,
        date: facture.avoir.date,
        montant: facture.avoir.montant
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors de la création de l\'avoir:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la création de l\'avoir.',
      success: false
    });
  }
});
///////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Route GET pour obtenir des statistiques détaillées sur les factures
 * URL: /api/factures/statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Statistiques par statut de paiement
    const statsByStatus = await Facture.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          // Exclure les factures annulées des autres stats
          statut: { $ne: 'ANNULEE' }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: '$montantHT' }
        }
      },
      {
        $project: {
          _id: 0,
          status: '$_id',
          count: 1,
          total: 1
        }
      }
    ]);

    // Transformer en objet pour faciliter l'accès
    const byStatus = statsByStatus.reduce((acc, stat) => {
      acc[stat.status || 'unknown'] = {
        count: stat.count,
        total: stat.total
      };
      return acc;
    }, {});

    // 2. Statistiques par type (normal, rectification, rectifiée, avoir)
    const factures = await Facture.find({ user: userId });

    const byType = {
      normal: { count: 0, total: 0 },
      rectification: { count: 0, total: 0 },
      rectifiee: { count: 0, total: 0 },
      avoir: { count: 0, total: 0 }
    };

    factures.forEach(facture => {
      if (facture.avoir) {
        byType.avoir.count++;
        byType.avoir.total += facture.avoir.montant || 0;
      }
      else if (facture.isRectification) {
        byType.rectification.count++;
        byType.rectification.total += facture.montantHT || 0;
      }
      else if (facture.statut === 'RECTIFIEE') {
        byType.rectifiee.count++;
        byType.rectifiee.total += facture.montantHT || 0;
      }
      else if (facture.statut !== 'ANNULEE') {
        byType.normal.count++;
        byType.normal.total += facture.montantHT || 0;
      }
    });

    // 3. Statistiques par client (top clients)
    const statsByClient = await Facture.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(userId),
          status: 'paid',
          statut: { $ne: 'ANNULEE' }
        }
      },
      {
        $group: {
          _id: '$client',
          count: { $sum: 1 },
          total: { $sum: '$montantHT' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'clients',
          localField: '_id',
          foreignField: '_id',
          as: 'clientDetails'
        }
      },
      { $unwind: '$clientDetails' },
      {
        $project: {
          _id: 0,
          clientId: '$_id',
          clientName: '$clientDetails.name',
          count: 1,
          total: 1
        }
      }
    ]);

    res.json({
      byStatus,
      byType,
      byClient: statsByClient
    });

  } catch (error) {
    console.error('Erreur statistiques factures:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des statistiques.' });
  }
});

/////////////////////////////////////////////////////////////////////////////


/**
 * Route GET pour récupérer les factures avec avoir
 * URL: /api/factures/avoirs
 */
router.get('/avoirs', async (req, res) => {
  try {
    const userId = req.user._id;

    // Récupérer toutes les factures avec un avoir
    const facturesAvecAvoirs = await Facture.find({
      user: userId,
      avoir: { $exists: true, $ne: null }
    })
      .populate('client')
      .sort({ 'avoir.date': -1 }); // Les plus récents d'abord

    res.json(facturesAvecAvoirs);
  } catch (error) {
    console.error('Erreur récupération avoirs:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

/**
 * Route GET pour récupérer le total des avoirs par période
 * URL: /api/factures/avoirs/stats
 */
router.get('/avoirs/stats', async (req, res) => {
  try {
    const userId = req.user._id;
    const { period } = req.query; // 'monthly', 'annual', ou non spécifié pour le total

    // Match de base pour filtrer par utilisateur et présence d'avoir
    const match = {
      user: new mongoose.Types.ObjectId(userId),
      avoir: { $exists: true, $ne: null }
    };

    // Ajouter des conditions de date si nécessaire (année, mois...)
    if (req.query.year) {
      const year = parseInt(req.query.year, 10);
      match['avoir.date'] = {
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31, 23, 59, 59)
      };
    }

    let pipeline = [];

    // Étape $match commune
    pipeline.push({ $match: match });

    // Étapes spécifiques selon la période demandée
    if (period === 'monthly') {
      pipeline = [
        ...pipeline,
        {
          $group: {
            _id: {
              year: { $year: '$avoir.date' },
              month: { $month: '$avoir.date' }
            },
            totalAvoirs: { $sum: '$avoir.montant' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ];
    } else if (period === 'annual') {
      pipeline = [
        ...pipeline,
        {
          $group: {
            _id: { year: { $year: '$avoir.date' } },
            totalAvoirs: { $sum: '$avoir.montant' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1 } }
      ];
    } else {
      // Total global
      pipeline = [
        ...pipeline,
        {
          $group: {
            _id: null,
            totalAvoirs: { $sum: '$avoir.montant' },
            count: { $sum: 1 }
          }
        }
      ];
    }

    const result = await Facture.aggregate(pipeline);

    res.json(result);
  } catch (error) {
    console.error('Erreur stats avoirs:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

/**
 * Route GET pour le détail d'un avoir spécifique
 * URL: /api/factures/:id/avoir
 */
router.get('/:id/avoir', async (req, res) => {
  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    const facture = await Facture.findOne({
      _id: factureId,
      user: userId,
      avoir: { $exists: true, $ne: null }
    }).populate('client');

    if (!facture) {
      return res.status(404).json({ message: 'Avoir non trouvé.' });
    }

    res.json({
      factureId: facture._id,
      factureNumero: facture.invoiceNumber,
      client: facture.client,
      avoir: facture.avoir
    });
  } catch (error) {
    console.error('Erreur récupération avoir:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

/////////////////////////////////////////////////////////////////////////////////////////////////

router.get('/:id/credit-note/pdf', async (req, res) => {
  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    const facture = await Facture.findOne({ _id: factureId, user: userId });
    if (!facture || !facture.avoir) {
      return res.status(404).json({ message: 'Avoir non trouvé pour cette facture' });
    }

    const client = await Client.findById(facture.client);

    const businessInfo = await BusinessInfo.findOne({ user: userId });
    if (!businessInfo) {
      return res.status(404).json({ message: "Informations entreprise non trouvées" });
    }

    const pdfBuffer = await generateCreditNotePDF(facture, client, businessInfo);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': 'inline; filename=avoir.pdf'
    });
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Erreur PDF avoir:', error);
    res.status(500).json({ message: error.message });
  }
});

///////////////////////////////////////////////////////////////////////////////////////

/**
 * Route POST pour marquer une facture comme envoyée au client
 * URL: /api/factures/:id/mark-as-sent
 */
router.post('/:id/mark-as-sent', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    const facture = await Facture.findOne({ _id: factureId, user: userId }).session(session);
    if (!facture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture non trouvée.' });
    }

    // Vérifier si la facture est déjà marquée comme envoyée
    if (facture.isSentToClient) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Cette facture est déjà marquée comme envoyée.' });
    }

    // Si c'est un brouillon, le passer en non payé
    if (facture.status === 'draft') {
      facture.status = 'unpaid';
    }

    // Marquer comme envoyée
    facture.isSentToClient = true;
    facture.dateSent = new Date();

    await facture.save({ session });

    // Mettre à jour les prestations associées
    await Prestation.updateMany(
      { invoiceId: factureId },
      {
        $set: {
          invoiceStatus: facture.status,
          invoiceIsSentToClient: true,
          invoiceLocked: facture.locked
        }
      },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: 'Facture marquée comme envoyée au client.',
      success: true,
      facture
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors du marquage de la facture comme envoyée:', error);
    res.status(500).json({
      message: 'Erreur serveur lors du marquage de la facture.',
      success: false
    });
  }
});

///////////////////////////////////////////////////////////////////////////////////////////

/**
 * Route POST pour dupliquer une facture
 * URL: /api/factures/:id/duplicate
 */
router.post('/:id/duplicate', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const factureId = req.params.id;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    // Trouver la facture originale
    const originalFacture = await Facture.findOne({ _id: factureId, user: userId })
      .populate('prestations')
      .session(session);

    if (!originalFacture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture non trouvée.' });
    }

    // Récupérer les informations de l'entreprise
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    if (!businessInfo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Paramètres de facturation non trouvés.' });
    }

    // Créer des copies des prestations
    const newPrestations = [];
    for (const prestation of originalFacture.prestations) {
      const newPrestation = new Prestation({
        user: userId,
        client: originalFacture.client,
        date: prestation.date,
        description: prestation.description,
        billingType: prestation.billingType,
        hours: prestation.hours,
        hourlyRate: prestation.hourlyRate,
        fixedPrice: prestation.fixedPrice,
        quantity: prestation.quantity,
        duration: prestation.duration,
        durationUnit: prestation.durationUnit,
        total: prestation.total,
        invoiceId: null // Sera rempli plus tard
      });
      const savedPrestation = await newPrestation.save({ session });
      newPrestations.push(savedPrestation);
    }

    // Créer une nouvelle facture avec les informations de l'originale
    const nextInvoiceNumber = await getNextInvoiceNumber(userId);
    const newFacture = new Facture({
      user: userId,
      client: originalFacture.client,
      prestations: newPrestations.map(p => p._id),
      montantHT: originalFacture.montantHT,
      taxeURSSAF: originalFacture.taxeURSSAF,
      montantNet: originalFacture.montantNet,
      montantTVA: originalFacture.montantTVA,
      montantTTC: originalFacture.montantTTC,
      nombreHeures: originalFacture.nombreHeures,
      invoiceNumber: nextInvoiceNumber,
      year: originalFacture.year,
      month: originalFacture.month,
      dateFacture: new Date(),
      dateEcheance: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 jours par défaut
      status: 'draft', // Toujours commencer comme brouillon
      isSentToClient: false
    });

    await newFacture.save({ session });

    // Mettre à jour les prestations avec le nouvel ID de facture
    await Prestation.updateMany(
      { _id: { $in: newPrestations.map(p => p._id) } },
      {
        $set: {
          invoiceId: newFacture._id,
          invoiceStatus: 'draft',
          invoiceIsSentToClient: false,
          invoiceLocked: false,
          invoicePaid: false
        }
      },
      { session }
    );

    // Mise à jour du numéro de facture dans BusinessInfo
    businessInfo.currentInvoiceNumber = nextInvoiceNumber;
    await businessInfo.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      message: 'Facture dupliquée avec succès',
      success: true,
      facture: newFacture
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors de la duplication de la facture:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la duplication de la facture.',
      success: false
    });
  }
});


module.exports = router;


















