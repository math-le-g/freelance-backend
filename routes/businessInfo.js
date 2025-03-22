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
  body('taxeURSSAF').optional().isNumeric().withMessage('La taxe URSSAF doit être un nombre.'),
//////////////////////////////////////////////////////////////////////////////////////////////////////
  body('legalMessages.enableLatePaymentComment').optional().isBoolean(),
  body('legalMessages.latePaymentText').optional().isString(),
  body('legalMessages.enableCustomComment').optional().isBoolean(),          ////en test
  body('legalMessages.customCommentText').optional().isString(),
///////////////////////////////////////////////////////////////////////////////////////////////////////
];

// GET /api/business-info - Récupérer les informations de l'entreprise
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const businessInfo = await BusinessInfo.findOne({ user: userId });

    // console.log('Requête GET /api/business-info - Utilisateur:', userId);


    if (!businessInfo) {
      console.log('Informations de l\'entreprise non trouvées pour l\'utilisateur:', userId);
      return res.json({});
    }

    console.log('Informations de l\'entreprise récupérées pour l\'utilisateur:', userId);
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

    const updatedData = {
      ...req.body,
      taxeURSSAF: req.body.taxeURSSAF !== undefined ? req.body.taxeURSSAF : (businessInfo?.taxeURSSAF || 0.232),
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
      // NOUVEAU: Mise à jour des messages légaux et commentaires
      legalMessages: {
        enableLatePaymentComment: req.body.legalMessages?.enableLatePaymentComment ?? (businessInfo?.legalMessages?.enableLatePaymentComment || false),
        latePaymentText: req.body.legalMessages?.latePaymentText ?? (businessInfo?.legalMessages?.latePaymentText || "Tout retard de paiement entraînera une indemnité forfaitaire pour frais de recouvrement de 40 euros (Article L441-10 du Code de commerce)."),
        enableCustomComment: req.body.legalMessages?.enableCustomComment ?? (businessInfo?.legalMessages?.enableCustomComment || false),
        customCommentText: req.body.legalMessages?.customCommentText ?? (businessInfo?.legalMessages?.customCommentText || ""),
      }
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
    // Préparer les données de mise à jour en utilisant les données reçues ou en gardant l’existant
    const updatedData = {
      ...req.body,
      taxeURSSAF: req.body.taxeURSSAF !== undefined ? req.body.taxeURSSAF : (businessInfo?.taxeURSSAF || 0.246),
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

   
    if (legalMessages) {
      if (!businessInfo.legalMessages) businessInfo.legalMessages = {};

      if (legalMessages.enableLatePaymentComment !== undefined) {
        businessInfo.legalMessages.enableLatePaymentComment = legalMessages.enableLatePaymentComment;
      }

      if (legalMessages.latePaymentText !== undefined) {
        businessInfo.legalMessages.latePaymentText = legalMessages.latePaymentText;
      }

      if (legalMessages.enableCustomComment !== undefined) {
        businessInfo.legalMessages.enableCustomComment = legalMessages.enableCustomComment;
      }

      if (legalMessages.customCommentText !== undefined) {
        businessInfo.legalMessages.customCommentText = legalMessages.customCommentText;
      }
    }

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
*/

