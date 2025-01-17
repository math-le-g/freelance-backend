const express = require('express');
const router = express.Router();
const BusinessInfo = require('../models/BusinessInfo');
const { body, validationResult } = require('express-validator');

/**
 * Middleware de validation optionnelle pour les informations d'entreprise
 * Tous les champs sont optionnels afin de permettre de mettre à jour partiellement.
 */
const validateBusinessInfoOptional = [
  body('name').optional().isString().withMessage('Le nom de l\'entreprise doit être une chaîne.'),
  body('address').optional().isString().withMessage('L\'adresse doit être une chaîne.'),
  body('postalCode').optional().isString().withMessage('Le code postal doit être une chaîne.'),
  body('city').optional().isString().withMessage('La ville doit être une chaîne.'),
  body('phone').optional().isString().withMessage('Le numéro de téléphone doit être une chaîne.'),
  body('email').optional().isEmail().withMessage('Email invalide.'),
  body('siret').optional().isString().withMessage('Le SIRET doit être une chaîne.'),
  body('companyType').optional().isString().withMessage('Le type d\'entreprise doit être une chaîne.'),
  body('invoiceNumberStart').optional().isInt({ min: 1 }).withMessage('invoiceNumberStart doit être un entier positif.'),
  body('features.invoiceStatus.enabled').optional().isBoolean(),
  body('features.invoiceStatus.paymentDelay').optional().isInt({ min: 1 }),
  body('features.automaticReminders.enabled').optional().isBoolean(),
  body('features.automaticReminders.firstReminder').optional().isInt({ min: 1 }),
  body('features.automaticReminders.secondReminder').optional().isInt({ min: 1 }),
  body('features.automaticReminders.thirdReminder').optional().isInt({ min: 1 }),
  body('displayOptions.showDueDateOnInvoice').optional().isBoolean(),
  body('displayOptions.showDueDateInHistory').optional().isBoolean(),
];

// GET /api/business-info - Récupérer les informations de l'entreprise
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const businessInfo = await BusinessInfo.findOne({ user: userId });
    if (!businessInfo) {
      return res.json({});
    }
    res.json(businessInfo);
  } catch (error) {
    console.error('Erreur lors de la récupération des informations:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// POST /api/business-info - Créer ou mettre à jour les informations de l'entreprise
router.post('/', validateBusinessInfoOptional, async (req, res) => {
  // Validation des données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const userId = req.user._id;
    let businessInfo = await BusinessInfo.findOne({ user: userId });

    // Préparer les données de mise à jour en utilisant les données reçues ou en gardant l’existant
    const updatedData = {
      ...req.body,
      features: {
        invoiceStatus: {
          enabled: req.body.features?.invoiceStatus?.enabled ?? (businessInfo?.features?.invoiceStatus?.enabled || false),
          paymentDelay: req.body.features?.invoiceStatus?.paymentDelay ?? (businessInfo?.features?.invoiceStatus?.paymentDelay || 30)
        },
        automaticReminders: {
          enabled: req.body.features?.automaticReminders?.enabled ?? (businessInfo?.features?.automaticReminders?.enabled || false),
          firstReminder: req.body.features?.automaticReminders?.firstReminder ?? (businessInfo?.features?.automaticReminders?.firstReminder || 7),
          secondReminder: req.body.features?.automaticReminders?.secondReminder ?? (businessInfo?.features?.automaticReminders?.secondReminder || 15),
          thirdReminder: req.body.features?.automaticReminders?.thirdReminder ?? (businessInfo?.features?.automaticReminders?.thirdReminder || 30)
        },
      },
      displayOptions: {
        showDueDateOnInvoice: req.body.displayOptions?.showDueDateOnInvoice ?? (businessInfo?.displayOptions?.showDueDateOnInvoice ?? true),
        showDueDateInHistory: req.body.displayOptions?.showDueDateInHistory ?? (businessInfo?.displayOptions?.showDueDateInHistory ?? true),
        showTvaComment: req.body.displayOptions?.showTvaComment ?? (businessInfo?.displayOptions?.showTvaComment ?? true),
      },
    };

    if (businessInfo) {
      businessInfo = await BusinessInfo.findOneAndUpdate(
        { user: userId },
        updatedData,
        { new: true, runValidators: true }
      );
    } else {
      businessInfo = new BusinessInfo({ user: userId, ...updatedData });
      await businessInfo.save();
    }
    res.status(businessInfo ? 200 : 201).json(businessInfo);
  } catch (error) {
    console.error('Erreur lors de la mise à jour des informations:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour des paramètres de facturation.' });
  }
});

module.exports = router;



/*

const express = require('express');
const router = express.Router();
const BusinessInfo = require('../models/BusinessInfo');

const { body, validationResult } = require('express-validator');




const validateBusinessInfo = [
  body('name').isString().withMessage('Le nom de l\'entreprise est requis.'),
  body('address').isString().withMessage('L\'adresse est requise.'),
  body('postalCode').isString().withMessage('Le code postal est requis.'),
  body('city').isString().withMessage('La ville est requise.'),
  body('phone').isString().withMessage('Le numéro de téléphone est requis.'),
  body('email').isEmail().withMessage('Email invalide.'),
  body('siret').isString().withMessage('Le SIRET est requis.'),
  body('companyType').isString().withMessage('Le type d\'entreprise est requis.'),
  body('invoiceNumberStart').optional().isInt({ min: 1 }).withMessage('invoiceNumberStart doit être un entier positif.'),
  body('features.invoiceStatus.enabled').optional().isBoolean(),
  body('features.invoiceStatus.paymentDelay').optional().isInt({ min: 1 }),
  body('features.automaticReminders.enabled').optional().isBoolean(),
  body('features.automaticReminders.firstReminder').optional().isInt({ min: 1 }),
  body('features.automaticReminders.secondReminder').optional().isInt({ min: 1 }),
  body('features.automaticReminders.thirdReminder').optional().isInt({ min: 1 }),
  body('displayOptions.showDueDateOnInvoice').optional().isBoolean(),
  body('displayOptions.showDueDateInHistory').optional().isBoolean(),
];

// Récupérer les informations de l'entreprise
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const businessInfo = await BusinessInfo.findOne({ user: userId });
    if (!businessInfo) {
      return res.json({});
    }
    res.json(businessInfo);
  } catch (error) {
    console.error('Erreur lors de la récupération des informations:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// Créer ou mettre à jour les informations de l'entreprise
router.post('/', validateBusinessInfo, async (req, res) => {
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const userId = req.user._id;
    let businessInfo = await BusinessInfo.findOne({ user: userId });

    const updatedData = {
      ...req.body,
      features: {
        invoiceStatus: {
          enabled: req.body.features?.invoiceStatus?.enabled || false,
          paymentDelay: req.body.features?.invoiceStatus?.paymentDelay || 30
        },
        automaticReminders: {
          enabled: req.body.features?.automaticReminders?.enabled || false,
          firstReminder: req.body.features?.automaticReminders?.firstReminder || 7,
          secondReminder: req.body.features?.automaticReminders?.secondReminder || 15,
          thirdReminder: req.body.features?.automaticReminders?.thirdReminder || 30
        },
      },
      displayOptions: {
        showDueDateOnInvoice: req.body.displayOptions?.showDueDateOnInvoice ?? true,
        showDueDateInHistory: req.body.displayOptions?.showDueDateInHistory ?? true,
      },
    };

    if (businessInfo) {
      businessInfo = await BusinessInfo.findOneAndUpdate(
        { user: userId },
        updatedData,
        { new: true, runValidators: true }
      );
    } else {
      businessInfo = new BusinessInfo({
        user: userId,
        ...updatedData
      });
      await businessInfo.save();
    }

    res.status(businessInfo ? 200 : 201).json(businessInfo);
  } catch (error) {
    console.error('Erreur lors de la sauvegarde:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
*/