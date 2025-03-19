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
  body('billingType')
    .isIn(['hourly', 'fixed', 'daily'])
    .withMessage('Le type de facturation doit être "hourly", "fixed" ou "daily".'),

  // Si "hourly", on force hours & hourlyRate
  body('hours')
    .if(body('billingType').equals('hourly'))
    .isFloat({ min: 0 })
    .withMessage('Les heures doivent être un nombre positif.'),
  body('minutes')
    .if(body('billingType').equals('hourly'))
    .isFloat({ min: 0, max: 59 })
    .withMessage('Les minutes doivent être un nombre entre 0 et 59.'),
  body('hourlyRate')
    .if(body('billingType').equals('hourly'))
    .isFloat({ min: 0 })
    .withMessage('Le taux horaire doit être un nombre positif.'),

  // Si "fixed" ou "daily", on peut valider fixedPrice
  body('fixedPrice')
    .if(body('billingType').custom((val) => val === 'fixed' || val === 'daily'))
    .isFloat({ min: 0 })
    .withMessage('Le prix doit être un nombre positif.'),

  // On peut valider quantity seulement en "fixed"
  body('quantity')
    .if(body('billingType').equals('fixed'))
    .isInt({ min: 1 })
    .withMessage('La quantité doit être un entier positif.'),

  // Client
  body('clientId').isMongoId().withMessage('Client ID invalide.'),
];

/**
 * Met à jour les informations de facture sur les prestations associées
 * Utile pour avoir un accès rapide au statut
 */
async function updatePrestationsWithInvoiceInfo(invoiceId, session = null) {
  try {
    // Récupérer les informations de la facture
    const facture = await Facture.findById(invoiceId).session(session || null);
    
    if (!facture) {
      return false;
    }
    
    // Mettre à jour toutes les prestations associées
    const updateData = {
      invoiceStatus: facture.status,
      invoiceIsSentToClient: facture.isSentToClient || facture.status !== 'draft',
      invoiceLocked: facture.locked
    };
    
    // Option pour la session Mongoose si fournie
    const options = session ? { session } : {};
    
    await Prestation.updateMany(
      { invoiceId: facture._id },
      { $set: updateData },
      options
    );
    
    return true;
  } catch (error) {
    console.error('Erreur lors de la mise à jour des infos de facture sur les prestations:', error);
    return false;
  }
}

// Créer une nouvelle prestation
router.post('/', validatePrestation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const {
      description,
      billingType,
      hours,
      minutes,
      hourlyRate,
      fixedPrice,
      quantity,
      clientId,
      date,
      duration,       // <-- récupère la valeur envoyée par le front
      durationUnit    // <-- récupère l'unité envoyée par le front
    } = req.body;

    const userId = req.user._id;

    // Vérifier que le client existe et appartient à l'utilisateur connecté
    const client = await Client.findOne({ _id: clientId, user: userId });
    if (!client) {
      return res.status(400).json({
        message: 'Le client spécifié n\'existe pas ou ne vous appartient pas.'
      });
    }

     // Calcul de la durée (en minutes) et du total
     let total = 0;
     let finalDuration = 0;
     let finalDurationUnit = 'minutes';
 
     if (billingType === 'hourly') {
       // ex. total = (hours + minutes/60) * hourlyRate
       const hourInput = parseFloat(hours) || 0;
       const minuteInput = parseFloat(minutes) || 0;
       const totalHours = hourInput + (minuteInput / 60);
       total = totalHours * (hourlyRate || 0);
 
       finalDuration = (hourInput * 60) + minuteInput; 
       finalDurationUnit = 'minutes';
 
     } else if (billingType === 'fixed') {
       // total = prix unitaire × quantité
       total = (fixedPrice || 0) * (quantity || 1);
 
       // Récupérer la durée si l'utilisateur en a renseigné une
       finalDuration = parseInt(duration, 10) || 0;
       finalDurationUnit = durationUnit || 'minutes';
 
     } else if (billingType === 'daily') {
       // Logique pour 'daily'
       total = (fixedPrice || 0) * (quantity || 1);
 
       // Si vous voulez stocker la durée ici aussi :
       finalDuration = parseInt(duration, 10) || 0;
       finalDurationUnit = durationUnit || 'days';
     }
 


    // Création de la prestation
    let prestation = new Prestation({
      user: req.user._id,
      client: clientId,
      description,
      billingType,
      hours: parseFloat(hours) || 0,
      minutes: parseFloat(minutes) || 0,       // si vous voulez les conserver
      hourlyRate: parseFloat(hourlyRate) || 0,
      fixedPrice: parseFloat(fixedPrice) || 0,
      quantity: parseInt(quantity, 10) || 1,
      duration: finalDuration,
      durationUnit: finalDurationUnit,
      date: date || new Date(),
      total
    });

    prestation = await prestation.save();
    prestation = await prestation.populate('client');
    return res.status(201).json(prestation);

  } catch (error) {
    console.error('Erreur lors de la création de la prestation:', error);
    return res.status(500).json({ message: 'Erreur serveur' });
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
      minutes,
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
    
    // 2.1) Vérifier si la facture associée est verrouillée
    if (existingPrestation.invoiceLocked) {
      return res.status(403).json({
        message: 'Cette prestation est liée à une facture verrouillée et ne peut pas être modifiée.'
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

    // 5) Mettre à jour selon le type
    if (billingType === 'hourly') {
      existingPrestation.hours = parseFloat(hours) || 0;
      existingPrestation.minutes = parseFloat(minutes) || 0;
      existingPrestation.hourlyRate = parseFloat(hourlyRate) || 0;
      existingPrestation.fixedPrice = undefined;
      existingPrestation.quantity = 1; // par sécurité
      existingPrestation.durationUnit = 'minutes';

      // (NOUVEAU : recalcul du total et de la durée)
      const totalHours = existingPrestation.hours + (existingPrestation.minutes / 60);
      existingPrestation.total = totalHours * existingPrestation.hourlyRate;
      existingPrestation.duration = (existingPrestation.hours * 60) + existingPrestation.minutes;

    } else if (billingType === 'daily') {
      existingPrestation.fixedPrice = parseFloat(fixedPrice) || 0;
      existingPrestation.hours = undefined;
      existingPrestation.minutes = undefined;
      existingPrestation.hourlyRate = undefined;
      existingPrestation.quantity = 1; // on ignore quantity
      existingPrestation.duration = parseInt(duration, 10) || 0;
      existingPrestation.durationUnit = durationUnit || 'days';

      // (NOUVEAU : recalcul du total)
      existingPrestation.total = existingPrestation.fixedPrice * 1; // ou ta logique "daily"

    } else {
      // "fixed"
      existingPrestation.fixedPrice = parseFloat(fixedPrice) || 0;
      existingPrestation.hours = undefined;
      existingPrestation.minutes = undefined;
      existingPrestation.hourlyRate = undefined;
      existingPrestation.quantity = quantity ? parseInt(quantity, 10) : existingPrestation.quantity;
      existingPrestation.duration = parseInt(duration, 10) || 0;
      existingPrestation.durationUnit = durationUnit || 'minutes';

      // (NOUVEAU : recalcul du total)
      existingPrestation.total =
        (existingPrestation.fixedPrice || 0) * (existingPrestation.quantity || 1);
    }

    // 6) Sauvegarder
    await existingPrestation.save();

    // 7) Populate si besoin
    await existingPrestation.populate('client');

    // 8) Si la prestation est liée à une facture, on met à jour la facture
    if (existingPrestation.invoiceId) {
      const facture = await Facture.findById(existingPrestation.invoiceId);
      if (facture) {
        // Récupérer toutes les prestations associées à cette facture
        const prestations = await Prestation.find({ invoiceId: facture._id });
        
        // Recalculer le montant HT et autres
        const montantHT = prestations.reduce((sum, p) => sum + p.total, 0);
        
        // Mise à jour de la facture
        facture.montantHT = montantHT;
        
        // Recalculer taxe URSSAF, montant net, etc. (selon votre logique)
        const taxRate = 0.246; // à adapter
        facture.taxeURSSAF = parseFloat((montantHT * taxRate).toFixed(2));
        facture.montantNet = parseFloat((montantHT - facture.taxeURSSAF).toFixed(2));
        
        await facture.save();
      }
    }

    // 9) Renvoyer la version finale
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
    
    // Vérifier si la prestation est liée à une facture verrouillée/envoyée
    if (existingPrestation.invoiceLocked || existingPrestation.invoiceIsSentToClient) {
      return res.status(403).json({
        message: 'Les prestations liées à des factures verrouillées ou envoyées ne peuvent pas être supprimées.'
      });
    }

    const deletedPrestation = await Prestation.findOneAndDelete({
      _id: prestationId,
      user: userId
    });

    // Si la prestation était liée à une facture, mettre à jour les montants de la facture
    if (existingPrestation.invoiceId) {
      const facture = await Facture.findById(existingPrestation.invoiceId);
      if (facture && facture.status === 'draft' && !facture.isSentToClient) {
        // Récupérer toutes les prestations associées à cette facture (sans celle supprimée)
        const prestations = await Prestation.find({ 
          invoiceId: facture._id,
          _id: { $ne: prestationId }
        });
        
        // Recalculer le montant HT et autres
        const montantHT = prestations.reduce((sum, p) => sum + p.total, 0);
        
        // Mise à jour de la facture
        facture.montantHT = montantHT;
        
        // Recalculer taxe URSSAF, montant net, etc.
        const taxRate = 0.246; // à remplacer par votre logique
        facture.taxeURSSAF = parseFloat((montantHT * taxRate).toFixed(2));
        facture.montantNet = parseFloat((montantHT - facture.taxeURSSAF).toFixed(2));
        
        // Mettre à jour la liste des prestations associées
        facture.prestations = prestations.map(p => p._id);
        
        await facture.save();
      }
    }

    res.json({ message: 'Prestation supprimée avec succès.' });
  } catch (error) {
    console.error('Erreur suppression prestation:', error);
    res.status(500).json({
      message: 'Erreur serveur lors de la suppression de la prestation.'
    });
  }
});

module.exports = router;
module.exports.updatePrestationsWithInvoiceInfo = updatePrestationsWithInvoiceInfo;

