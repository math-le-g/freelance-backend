const express = require('express');
const router = express.Router();
const Description = require('../models/Description');
const authenticateToken = require('../middleware/authenticateToken');

// GET /api/descriptions - Récupérer les suggestions de description
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { search, limit = 30 } = req.query;
    const query = { user: req.user._id };

    if (search) {
      query.text = { $regex: search, $options: 'i' };
    }

    const descriptions = await Description.find(query)
      .sort({ frequency: -1, lastUsed: -1 })
      .limit(parseInt(limit, 10));

    res.json(descriptions);
  } catch (error) {
    console.error('Erreur lors de la récupération des descriptions:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST /api/descriptions - Ajouter/mettre à jour une description
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body;
    const userId = req.user._id;

    let description = await Description.findOne({ user: userId, text });

    if (description) {
      // Mettre à jour la fréquence et la date de dernière utilisation
      description.frequency += 1;
      description.lastUsed = new Date();
      await description.save();
    } else {
      // Créer une nouvelle description
      description = new Description({
        user: userId,
        text
      });
      await description.save();
    }

    res.status(201).json(description);
  } catch (error) {
    console.error('Erreur lors de l\'ajout ou la mise à jour de la description:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// DELETE /api/descriptions/:id - Supprimer une description
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    // On supprime la description correspondant à l'id et appartenant à l'utilisateur
    const description = await Description.findOneAndDelete({ _id: id, user: userId });
    if (!description) {
      return res.status(404).json({ message: 'Description introuvable ou ne vous appartient pas.' });
    }

    res.status(200).json({ message: 'Description supprimée avec succès.' });
  } catch (error) {
    console.error('Erreur lors de la suppression de la description:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
