const express = require('express');
const router = express.Router();
const User = require('../models/User');


// Route pour obtenir les paramètres de facturation
router.get('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('billingSettings');
    res.json(user.billingSettings || {});
  } catch (error) {
    console.error('Erreur lors de la récupération des paramètres de facturation:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// Route pour mettre à jour les paramètres de facturation
router.put('/', async (req, res) => {
  try {
    const userId = req.user._id;
    const { invoiceTitle } = req.body;

    const user = await User.findById(userId);
    user.billingSettings = {
      ...user.billingSettings,
      invoiceTitle,
    };
    await user.save();

    res.json(user.billingSettings);
  } catch (error) {
    console.error('Erreur lors de la mise à jour des paramètres de facturation:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
