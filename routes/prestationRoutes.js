const express = require('express');
const router = express.Router();
const Prestation = require('../models/Prestation');
const Client = require('../models/Client');
const Facture = require('../models/Facture');
const { body, validationResult } = require('express-validator');

/*
 * Middleware de validation pour les prestations
 */
const validatePrestation = [
  body('description').isString().withMessage('La description est requise.'),
  body('billingType').isIn(['hourly', 'fixed', 'daily']).withMessage('Le type de facturation doit être "hourly", "fixed" ou "daily".'),

  // Si "hourly", on force hours & hourlyRate
  body('hours').if(body('billingType').equals('hourly')).isFloat({ min: 0 }).withMessage('Les heures doivent être un nombre positif.'),
  body('hourlyRate').if(body('billingType').equals('hourly')).isFloat({ min: 0 }).withMessage('Le taux horaire doit être un nombre positif.'),

  // Si "fixed" ou "daily", on peut valider fixedPrice
  body('fixedPrice').if(body('billingType').custom((val) => val === 'fixed' || val === 'daily')).isFloat({ min: 0 }).withMessage('Le prix doit être un nombre positif.'),

  // On peut valider quantity seulement en "fixed"
  body('quantity').if(body('billingType').equals('fixed')).isInt({ min: 1 }).withMessage('La quantité doit être un entier positif.'),

  // Durée
  body('duration').optional().isInt({ min: 0 }).withMessage('La durée doit être un nombre entier positif (en minutes).'),

  // Client
  body('clientId').isMongoId().withMessage('Client ID invalide.'),

  // Date
  body('date').optional().isISO8601().toDate().withMessage('Date invalide.'),
];

// Créer une nouvelle prestation
router.post('/', validatePrestation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const { description, billingType, hours, hourlyRate, fixedPrice, duration, durationValue, durationUnit, clientId, date, quantity } = req.body;
    const userId = req.user._id;

    // Vérifier que le client existe et appartient à l'utilisateur connecté
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({
        message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.'
      });
    }

    // Calculer le total selon le type de facturation
    let total = 0;
    if (billingType === 'hourly') {
      total = hours * hourlyRate;
    } else if (billingType === 'fixed') {
      // Forfait => calcul partiel
      total = fixedPrice; 
    } else if (billingType === 'daily') {
      // on laisse le pre('save') gérer
      total = 0; 
    }



    // Créer la prestation (déclarer la variable en premier)
    let prestation = new Prestation({
      user: userId,
      description,
      billingType,
      hours: billingType === 'hourly' ? hours : undefined,
      hourlyRate: billingType === 'hourly' ? hourlyRate : undefined,
      fixedPrice: billingType === 'fixed' || billingType === 'daily' ? fixedPrice : undefined,
      quantity: billingType === 'fixed' ? (quantity || 1) : 1,
      duration,
      durationValue,
      durationUnit,
      total,
      client: clientId,
      date: date || new Date(),
      invoicePaid: false,
      invoiceId: null
    });

    

    prestation = await prestation.save();
    prestation = await prestation.populate('client');

    res.status(201).json(prestation);
  } catch (error) {
    console.error('Erreur lors de la création de la prestation:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la création de la prestation.'
    });
  }
});

// Récupérer toutes les prestations
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const { year, month } = req.query;

    let query = { user: userId };

    if (year && month) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      query.date = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const prestations = await Prestation.find(query)
      .populate('client')
      .sort({ date: 1 });

    res.json(prestations);
  } catch (error) {
    console.error('Erreur lors de la récupération des prestations:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la récupération des prestations.'
    });
  }
});

// Modifier une prestation
router.put('/:id', validatePrestation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const userId = req.user._id;
    const prestationId = req.params.id;
    const {
      description,
      billingType,
      hours,
      hourlyRate,
      fixedPrice,
      duration,
      durationUnit,
      clientId,
      date,
      quantity,
    } = req.body;

    // 1) Vérifier si la prestation existe
    const existingPrestation = await Prestation.findOne({
      _id: prestationId,
      user: userId
    });
    if (!existingPrestation) {
      return res.status(404).json({ message: 'Prestation non trouvée.' });
    }

    // 2) Vérifier si facturée payée
    if (existingPrestation.invoicePaid) {
      return res.status(403).json({
        message: 'Les prestations facturées ne peuvent pas être modifiées.'
      });
    }

    // 3) Vérifier le client
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({
        message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.'
      });
    }

    // 4) Mettre à jour les champs "communs"
    existingPrestation.description = description;
    existingPrestation.billingType = billingType;
    existingPrestation.client = clientId;
    existingPrestation.date = date || new Date();
    existingPrestation.duration = duration || 0;
    existingPrestation.durationUnit = durationUnit || existingPrestation.durationUnit;

    // 5) Gérer les champs selon le type
    if (billingType === 'hourly') {
      // p.hours / p.hourlyRate => calcul se fera dans pre('save')
      existingPrestation.hours = hours;
      existingPrestation.hourlyRate = hourlyRate;
      existingPrestation.fixedPrice = undefined;
      existingPrestation.quantity = 1;   // par sécurité
    }
    else if (billingType === 'daily') {
      // p.fixedPrice => total = nbJours × fixedPrice dans pre('save')
      existingPrestation.fixedPrice = fixedPrice;
      existingPrestation.hours = undefined;
      existingPrestation.hourlyRate = undefined;
      existingPrestation.quantity = 1;   // on ignore la quantity
    }
    else {
      // "fixed"
      existingPrestation.fixedPrice = fixedPrice;
      existingPrestation.hours = undefined;
      existingPrestation.hourlyRate = undefined;
      existingPrestation.quantity = quantity ? parseInt(quantity, 10) : existingPrestation.quantity;
      // quantity => si vous la gérez, vous pouvez la laisser
    }

    // 6) Sauvegarder => déclenchera le pre('save') => recalcul this.total
    await existingPrestation.save();

    // 7) Populate si besoin
    await existingPrestation.populate('client');

    // 8) Renvoyer la version finale
    res.json(existingPrestation);

  } catch (error) {
    console.error('Erreur modification prestation:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la modification de la prestation.'
    });
  }
});

// Supprimer une prestation
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user._id;
    const prestationId = req.params.id;

    // Vérifier si la prestation existe et n'est pas facturée
    const existingPrestation = await Prestation.findOne({
      _id: prestationId,
      user: userId
    });

    if (!existingPrestation) {
      return res.status(404).json({
        message: 'Prestation non trouvée.'
      });
    }

    // Vérifier si la prestation est liée à une facture payée
    if (existingPrestation.invoicePaid) {
      return res.status(403).json({
        message: 'Les prestations liées à des factures payées ne peuvent pas être supprimées.'
      });
    }



    const deletedPrestation = await Prestation.findOneAndDelete({
      _id: prestationId,
      user: userId
    });



    res.json({ message: 'Prestation supprimée avec succès.' });
  } catch (error) {
    console.error('Erreur suppression prestation:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la suppression de la prestation.'
    });
  }
});

module.exports = router;
