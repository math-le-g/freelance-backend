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
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const userId = req.user._id;
    const { clientId, year, month } = req.body;

    console.log('Données reçues pour prévisualisation:', { clientId, year, month });

    // Conversion et validation des données
    const parsedYear = parseInt(year, 10);
    const parsedMonth = parseInt(month, 10);

    // Vérification du client
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(404).json({ message: 'Client non trouvé ou non autorisé.' });
    }

    // Création de `dateFacture`
    const dateFacture = new Date();

    // Création des dates de début et fin du mois
    const startDate = startOfMonth(dateFacture);
    const endDate = endOfMonth(dateFacture);

    // Récupération des prestations
    const prestations = await Prestation.find({
      user: userId,
      client: clientId,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    });

    if (prestations.length === 0) {
      return res.status(404).json({ message: 'Aucune prestation trouvée pour ce client et ce mois.' });
    }

    // Calculs financiers
    const montantHT = prestations.reduce((acc, p) => acc + p.total, 0);
    const taxeURSSAF = parseFloat((montantHT * 0.232).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));
    const montantTVA = 0; // Ajuster si nécessaire
    const montantTTC = parseFloat((montantNet + montantTVA).toFixed(2)); // TVA=0, ajuster si nécessaire
    const nombreHeures = prestations.reduce((acc, p) => acc + p.hours, 0);

    // Récupérer les informations de l'entreprise
    const businessInfo = await BusinessInfo.findOne({ user: userId });
    if (!businessInfo) {
      return res.status(404).json({ message: 'Paramètres de facturation non trouvés.' });
    }

    // Détermination du numéro de facture pour prévisualisation
    const lastInvoice = await Facture.findOne({ user: userId }).sort({ invoiceNumber: -1 });
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

    // Facture temporaire pour prévisualisation
    const factureTemp = {
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
    };

    // Générer le PDF
    const pdfBuffer = await generateInvoicePDF(factureTemp, client, businessInfo, prestations);

    // Sauvegarder le PDF dans le dossier uploads/invoices
    const pdfDir = path.join(__dirname, '../public/uploads/invoices');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const sanitizedClientName = sanitizeClientName(client.name);
    const fileName = `Facture_${sanitizedClientName}_${format(new Date(factureTemp.dateFacture), 'MM_yyyy')}_${factureTemp.invoiceNumber}_${Date.now()}.pdf`;
    const filePath = path.join(pdfDir, fileName);
    const pdfPath = `uploads/invoices/${fileName}`;

    fs.writeFileSync(filePath, pdfBuffer);

    // Envoyer le PDF en réponse
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename=preview_facture.pdf',
    });
    res.sendFile(filePath);

  } catch (error) {
    console.error('Erreur lors de la prévisualisation:', error);
    res.status(500).json({ message: 'Erreur lors de la prévisualisation' });
  }
});

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

    // Calculs financiers
    const montantHT = prestations.reduce((acc, p) => acc + p.total, 0);
    const taxeURSSAF = parseFloat((montantHT * 0.232).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));
    const montantTVA = 0; // Ajuster si nécessaire
    const montantTTC = parseFloat((montantNet + montantTVA).toFixed(2)); // TVA=0, ajuster si nécessaire
    const nombreHeures = prestations.reduce((acc, p) => acc + p.hours, 0);

    // Récupérer les informations de l'entreprise
    const businessInfo = await BusinessInfo.findOne({ user: userId }).session(session);
    if (!businessInfo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: 'Paramètres de facturation non trouvés.'
      });
    }

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


    ///////////////////////////////////////////////////////////////////////////////////////////////
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
    //////////////////////////////////////////////////////////////////////////////////////////////////


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

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    const facture = await Facture.findOne({ _id: factureId, user: userId });

    if (!facture || !facture.pdfPath) {
      return res.status(404).json({ message: 'PDF de la facture non trouvé.' });
    }

    const pdfFullPath = path.join(__dirname, '../public', facture.pdfPath);

    // Vérifier si le fichier existe
    if (!fs.existsSync(pdfFullPath)) {
      return res.status(404).json({ message: 'Fichier PDF non trouvé.' });
    }

    res.sendFile(pdfFullPath);
  } catch (error) {
    console.error('Erreur GET /factures/:id/pdf:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération du PDF' });
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

    // Marquer toutes les prestations associées comme payées/////////////////////////////////////////////////////////
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
    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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


/**
 * Route PUT pour rectifier une facture
 * URL: /api/factures/:id/rectify
 */
router.put('/:id/rectify', [
  body('clientId').optional().isMongoId().withMessage('clientId invalide.'),
  body('dateFacture').optional().isISO8601().toDate().withMessage('dateFacture invalide.'),
  body('prestations').isArray().withMessage('prestations doit être un tableau.'),
  body('prestations.*.description').isString().withMessage('description est requise.'),
  body('prestations.*.hours').isFloat({ min: 0 }).withMessage('hours doit être un nombre positif.'),
  body('prestations.*.hourlyRate').isFloat({ min: 0 }).withMessage('hourlyRate doit être un nombre positif.'),
  body('prestations.*.date').optional().isISO8601().toDate().withMessage('date invalide.'),
  body('prestations.*._id').optional().isMongoId(),
  body('prestations.*._deleted').optional().isBoolean(),
  body('changesComment').optional().isString()
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
    const factureId = req.params.id;
    const {
      clientId,
      dateFacture,
      prestations = [],
      changesComment,
    } = req.body;

    // Vérifier si l'ID est valide
    if (!mongoose.Types.ObjectId.isValid(factureId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'ID de facture invalide.' });
    }

    // Récupérer la facture
    const facture = await Facture.findOne({ _id: factureId, user: userId })
      .populate('client')
      .populate('prestations')
      .session(session);

    if (!facture) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Facture introuvable ou non autorisée.' });
    }

    if (facture.status !== 'unpaid') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: 'Impossible de rectifier une facture payée ou en retard.'
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

    // Définir paymentDelay à partir de businessInfo
    const paymentDelay = businessInfo.features?.invoiceStatus?.paymentDelay || 30;

    // Archiver la version précédente
    facture.versions = facture.versions || [];
    facture.versions.push({
      date: new Date(),
      client: facture.client,
      dateFacture: facture.dateFacture,
      montantHT: facture.montantHT,
      taxeURSSAF: facture.taxeURSSAF,
      montantNet: facture.montantNet,
      montantTTC: facture.montantTTC,
      nombreHeures: facture.nombreHeures,
      changesComment: changesComment || 'Rectification'
    });

    // Mettre à jour le client si nécessaire
    if (clientId && clientId !== facture.client._id.toString()) {
      const client = await Client.findOne({ _id: clientId, user: userId }).session(session);
      if (!client) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Nouveau client non trouvé ou non autorisé.' });
      }
      facture.client = clientId;
    }

    // Mettre à jour la dateFacture
    if (dateFacture) {
      const nouvelleDate = new Date(dateFacture);
      if (isNaN(nouvelleDate)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'Date de facture invalide.' });
      }
      facture.dateFacture = nouvelleDate;
      facture.year = nouvelleDate.getFullYear();
      facture.month = nouvelleDate.getMonth() + 1;
    }

    // Gérer la liste de prestations
    const updatedPrestationsIds = [];

    for (const p of prestations) {
      if (p._id) {
        // Cas 1 : Prestations existantes
        if (p._deleted) {
          // Supprimer la prestation
          await Prestation.findByIdAndDelete(p._id).session(session);
        } else {
          // Mettre à jour
          const existingP = await Prestation.findOne({
            _id: p._id,
            user: userId
          }).session(session);
          if (existingP) {
            existingP.description = p.description;
            existingP.hours = p.hours;
            existingP.hourlyRate = p.hourlyRate;
            existingP.total = p.hours * p.hourlyRate;
            existingP.date = p.date ? new Date(p.date) : existingP.date;
            await existingP.save({ session });
            updatedPrestationsIds.push(existingP._id);
          }
        }
      } else {
        // Cas 2 : Nouvelle prestation
        const newP = new Prestation({
          user: userId,
          client: facture.client,
          description: p.description,
          hours: p.hours,
          hourlyRate: p.hourlyRate,
          total: p.hours * p.hourlyRate,
          date: p.date ? new Date(p.date) : new Date()
        });
        await newP.save({ session });
        updatedPrestationsIds.push(newP._id);
      }
    }

    // Mettre à jour la liste de prestations de la facture
    facture.prestations = updatedPrestationsIds;

    // Recalculer les montants
    const finalPrestations = await Prestation.find({
      _id: { $in: updatedPrestationsIds }
    }).session(session);

    const montantHT = finalPrestations.reduce((sum, pr) => sum + pr.total, 0);
    const taxeURSSAF = parseFloat((montantHT * 0.232).toFixed(2));
    const montantNet = parseFloat((montantHT - taxeURSSAF).toFixed(2));
    const montantTVA = 0; // Ajuster si nécessaire
    const montantTTC = parseFloat((montantNet + montantTVA).toFixed(2)); // TVA=0, ajuster si nécessaire
    const nombreHeures = finalPrestations.reduce((sum, pr) => sum + pr.hours, 0);

    facture.montantHT = montantHT;
    facture.taxeURSSAF = taxeURSSAF;
    facture.montantNet = montantNet;
    facture.montantTTC = montantTTC;
    facture.nombreHeures = nombreHeures;

    // Recalculer la date d'échéance basée sur la nouvelle dateFacture
    const dateEcheance = new Date(facture.dateFacture);
    dateEcheance.setDate(dateEcheance.getDate() + paymentDelay);
    facture.dateEcheance = dateEcheance;

    // Récupérer le client mis à jour
    const updatedClient = await Client.findById(facture.client).session(session);
    if (!updatedClient) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: 'Client non trouvé.'
      });
    }

    // Générer le PDF
    const pdfBuffer = await generateInvoicePDF(facture, updatedClient, businessInfo, finalPrestations);

    // Sauvegarder le PDF dans le dossier uploads/invoices
    const pdfDir = path.join(__dirname, '../public/uploads/invoices');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const sanitizedClientName = sanitizeClientName(updatedClient.name);
    const fileName = `Facture_${sanitizedClientName}_${format(new Date(facture.dateFacture), 'MM_yyyy')}_${facture.invoiceNumber}_${Date.now()}.pdf`;
    const filePath = path.join(pdfDir, fileName);
    const pdfPath = `uploads/invoices/${fileName}`;

    fs.writeFileSync(filePath, pdfBuffer);

    // Définir pdfPath directement
    facture.pdfPath = pdfPath;

    // Sauvegarder la facture avec le nouveau pdfPath
    await facture.save({ session });

    // Mise à jour des prestations ////////////////////////////////////////////////////////////////////////////////////
    await Prestation.updateMany(
      { _id: { $in: updatedPrestationsIds } },
      {
        $set: {
          invoiceId: facture._id,
          invoicePaid: facture.status === 'paid'
        }
      },
      { session }
    );
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


    // Commit de la transaction
    await session.commitTransaction();
    session.endSession();

    res.json({ message: 'Facture rectifiée avec succès.', facture });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Erreur lors de la rectification de la facture:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la rectification.' });
  }
});

module.exports = router;
