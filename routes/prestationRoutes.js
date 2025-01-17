const express = require('express');
const router = express.Router();
const Prestation = require('../models/Prestation');
const Client = require('../models/Client');
const Facture = require('../models/Facture');
const { body, validationResult } = require('express-validator');

/**
 * Middleware de validation pour les prestations
 */
const validatePrestation = [
  body('description').isString().withMessage('La description est requise.'),
  body('hours').isFloat({ min: 0 }).withMessage('Les heures doivent être un nombre positif.'),
  body('hourlyRate').isFloat({ min: 0 }).withMessage('Le taux horaire doit être un nombre positif.'),
  body('clientId').isMongoId().withMessage('Client ID invalide.'),
  body('date').optional().isISO8601().toDate().withMessage('Date invalide.')
];

// Créer une nouvelle prestation
router.post('/', validatePrestation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const { description, hours, hourlyRate, clientId, date } = req.body;
    const userId = req.user._id;

    // Vérifier que le client existe et appartient à l'utilisateur connecté
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({ 
        message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.' 
      });
    }

    // Calculer le total
    const total = hours * hourlyRate;

    // Créer la prestation
    let prestation = new Prestation({
      user: userId,
      description,
      hours,
      hourlyRate,
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

    // Vérifier si la prestation existe et appartient à l'utilisateur
    const existingPrestation = await Prestation.findOne({ 
      _id: prestationId, 
      user: userId 
    });

    if (!existingPrestation) {
      return res.status(404).json({ message: 'Prestation non trouvée.' });
    }

    // Vérifier si la prestation est déjà facturée
    if (existingPrestation.invoicePaid) {
      return res.status(403).json({ 
        message: 'Les prestations facturées ne peuvent pas être modifiées.' 
      });
    }

    const { description, hours, hourlyRate, clientId, date } = req.body;

    // Vérifier que le client existe et appartient à l'utilisateur
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({ 
        message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.' 
      });
    }

    // Calculer le nouveau total
    const total = hours * hourlyRate;

    const updatedPrestation = await Prestation.findOneAndUpdate(
      { _id: prestationId, user: userId },
      {
        description,
        hours,
        hourlyRate,
        total,
        client: clientId,
        date: date || new Date(),
      },
      { new: true, runValidators: true }
    ).populate('client');

    if (!updatedPrestation) {
      return res.status(404).json({ 
        message: 'Prestation non trouvée ou vous n\'êtes pas autorisé à la modifier.' 
      });
    }

    res.json(updatedPrestation);
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

/*
const express = require('express');
const router = express.Router();
const Prestation = require('../models/Prestation');
const Client = require('../models/Client');

const { body, validationResult } = require('express-validator');




 // Middleware de validation pour les prestations
 
const validatePrestation = [
  body('description').isString().withMessage('La description est requise.'),
  body('hours').isFloat({ min: 0 }).withMessage('Les heures doivent être un nombre positif.'),
  body('hourlyRate').isFloat({ min: 0 }).withMessage('Le taux horaire doit être un nombre positif.'),
  body('clientId').isMongoId().withMessage('Client ID invalide.'),
  body('date').optional().isISO8601().toDate().withMessage('Date invalide.')
];

// Créer une nouvelle prestation pour l'utilisateur connecté
router.post('/', validatePrestation, async (req, res) => {
  console.log('✅ POST /api/prestations => user:', req.user._id);
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const { description, hours, hourlyRate, clientId, date } = req.body;
    const userId = req.user._id;

    // Vérifier que le client existe et appartient à l'utilisateur connecté
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({ message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.' });
    }

    // Calculer le total
    const total = hours * hourlyRate;

    // Créer la prestation
    let prestation = new Prestation({
      user: userId,
      description,
      hours,
      hourlyRate,
      total,
      client: clientId,
      date: date || new Date(),
    });

    // Sauvegarder la prestation
    prestation = await prestation.save();

    // Peupler les détails du client
    prestation = await prestation.populate('client');

    res.status(201).json(prestation);
  } catch (error) {
    console.error('Erreur lors de la création de la prestation:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la création de la prestation.' });
  }
});

// Récupérer toutes les prestations de l'utilisateur connecté
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

    const prestations = await Prestation.find(query).populate('client').sort({ date: 1 });

    res.json(prestations);
  } catch (error) {
    console.error('Erreur lors de la récupération des prestations:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des prestations.' });
  }
});

// Modifier une prestation appartenant à l'utilisateur connecté
router.put('/:id', validatePrestation, async (req, res) => {
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const { description, hours, hourlyRate, clientId, date } = req.body;
    const userId = req.user._id;
    const prestationId = req.params.id;

    // Vérifier que le client existe et appartient à l'utilisateur connecté
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({ message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.' });
    }

    // Calculer le total
    const total = hours * hourlyRate;

    const updatedPrestation = await Prestation.findOneAndUpdate(
      { _id: prestationId, user: userId },
      {
        description,
        hours,
        hourlyRate,
        total,
        client: clientId,
        date: date || new Date(),
      },
      { new: true, runValidators: true }
    ).populate('client');

    if (!updatedPrestation) {
      return res.status(404).json({ message: 'Prestation non trouvée ou vous n\'êtes pas autorisé à la modifier.' });
    }

    res.json(updatedPrestation);
  } catch (error) {
    console.error('Erreur modification prestation:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la modification de la prestation.' });
  }
});

// Supprimer une prestation appartenant à l'utilisateur connecté
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user._id;
    const prestationId = req.params.id;

    const deletedPrestation = await Prestation.findOneAndDelete({ _id: prestationId, user: userId });

    if (!deletedPrestation) {
      return res.status(404).json({ message: 'Prestation non trouvée ou vous n\'êtes pas autorisé à la supprimer.' });
    }

    res.json({ message: 'Prestation supprimée avec succès.' });
  } catch (error) {
    console.error('Erreur suppression prestation:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la suppression de la prestation.' });
  }
});

module.exports = router;
*/