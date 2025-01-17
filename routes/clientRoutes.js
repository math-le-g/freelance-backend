const express = require('express');
const router = express.Router();
const Client = require('../models/Client');

const { body, validationResult } = require('express-validator');



/**
 * Middleware de validation pour les clients
 */
const validateClient = [
  body('name').isString().withMessage('Le nom est requis.'),
  body('email').isEmail().withMessage('Email invalide.'),
  body('street').optional().isString(),
  body('postalCode').optional().isString(),
  body('city').optional().isString()
];

// Créer un nouveau client pour l'utilisateur connecté
router.post('/', validateClient, async (req, res) => {
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  try {
    const { name, email, street, postalCode, city } = req.body;
    const userId = req.user._id; // Utiliser req.user._id

    const client = new Client({ user: userId, name, email, street, postalCode, city });
    await client.save();
    res.status(201).json(client);
  } catch (error) {
    if (error.code === 11000) {
      // Gestion des erreurs d'unicité
      res.status(400).json({ message: 'Un client avec cet email existe déjà.' });
    } else {
      console.error('Erreur lors de l\'ajout du client :', error);
      res.status(500).json({ message: 'Erreur serveur.' });
    }
  }
});

// Récupérer tous les clients de l'utilisateur connecté
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id; // Utiliser req.user._id
    const clients = await Client.find({ user: userId });
    res.status(200).json(clients);
  } catch (error) {
    console.error('Erreur lors de la récupération des clients :', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// Mettre à jour un client appartenant à l'utilisateur connecté
router.put('/:clientId', validateClient, async (req, res) => {
  // Valider les données
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }

  const { clientId } = req.params;
  const { name, email, street, postalCode, city } = req.body;
  const userId = req.user._id;

  try {
    const updatedClient = await Client.findOneAndUpdate(
      { _id: clientId, user: userId },
      { name, email, street, postalCode, city },
      { new: true, runValidators: true }
    );

    if (!updatedClient) {
      return res.status(404).json({ message: 'Client non trouvé ou vous n\'êtes pas autorisé à le modifier.' });
    }

    res.status(200).json(updatedClient);
  } catch (error) {
    if (error.code === 11000) {
      // Gestion des erreurs d'unicité lors de la mise à jour
      res.status(400).json({ message: 'Un client avec cet email existe déjà.' });
    } else {
      console.error('Erreur lors de la mise à jour du client :', error);
      res.status(500).json({ message: 'Erreur serveur.' });
    }
  }
});

// Supprimer un client appartenant à l'utilisateur connecté
router.delete('/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const userId = req.user._id;

  try {
    const deletedClient = await Client.findOneAndDelete({ _id: clientId, user: userId });

    if (!deletedClient) {
      return res.status(404).json({ message: 'Client non trouvé ou vous n\'êtes pas autorisé à le supprimer.' });
    }

    res.status(200).json({ message: 'Client supprimé avec succès.' });
  } catch (error) {
    console.error('Erreur lors de la suppression du client :', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
