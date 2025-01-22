const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const Facture = require('../models/Facture');


// =======================
// /api/dashboard/totals
// =======================
router.get('/totals', async (req, res) => {
  try {
    const userId = req.user._id;
    const year = parseInt(req.query.year, 10);

    // Filtre de base : userId + paid
    const match = {
      user: new mongoose.Types.ObjectId(userId),
      status: 'paid'
    };

    // Si on reçoit ?year=2025, on limite à l'année 2025
    if (year) {
      match.createdAt = {
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31, 23, 59, 59)
      };
    }

    const totals = await Facture.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalBrut: { $sum: '$montantHT' },
          totalNet: { $sum: '$montantNet' },
          totalTTC: { $sum: '$montantTTC' },
          totalURSSAF: { $sum: '$taxeURSSAF' },
        }
      }
    ]);

    // s'il n'y a aucune facture, totals[0] sera undefined => renvoyer 0
    if (!totals.length) {
      return res.json({ totalBrut: 0, totalNet: 0, totalTTC: 0, totalURSSAF: 0 });
    }

    // Sinon, retourner la 1ère (unique) ligne d'agrégat
    res.json({
      totalBrut: totals[0].totalBrut || 0,
      totalNet: totals[0].totalNet || 0,
      totalTTC: totals[0].totalTTC || 0,
      totalURSSAF: totals[0].totalURSSAF || 0 
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des totaux:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des totaux.' });
  }
});

// =======================
// /api/dashboard/monthly
// =======================
router.get('/monthly', async (req, res) => {
  try {
    const userId = req.user._id;
    const year = parseInt(req.query.year, 10);

    // Filtre de base : userId + paid
    const match = {
      user: new mongoose.Types.ObjectId(userId),
      status: 'paid'
    };

    // Si on reçoit ?year=2025, on limite à l'année 2025
    if (year) {
      match.createdAt = {
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31, 23, 59, 59)
      };
    }

    const monthlyStats = await Facture.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          totalFactures: { $sum: 1 },
          totalBrut: { $sum: '$montantHT' },
          totalNet: { $sum: '$montantNet' },
          totalTTC: { $sum: '$montantTTC' },
          totalURSSAF: { $sum: '$taxeURSSAF' },
        }
      },
      {
        $sort: {
          '_id.year': 1,
          '_id.month': 1
        }
      }
    ]);

    console.log('monthlyStats renvoyés:', monthlyStats);
    res.json(monthlyStats);
  } catch (error) {
    console.error('Erreur lors de la récupération des stats mensuelles:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des statistiques mensuelles.' });
  }
});

// =======================
// /api/dashboard/annual
// =======================
router.get('/annual', async (req, res) => {
  try {
    const userId = req.user._id;
    const year = parseInt(req.query.year, 10);

    // Filtre de base : userId + paid
    const match = {
      user: new mongoose.Types.ObjectId(userId),
      status: 'paid'
    };

    // Optionnel : si year, on limite
    if (year) {
      match.createdAt = {
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31, 23, 59, 59)
      };
    }

    const annualStats = await Facture.aggregate([
      { $match: match },
      {
        $group: {
          _id: { year: { $year: '$createdAt' } },
          totalFactures: { $sum: 1 },
          totalBrut: { $sum: '$montantHT' },
          totalNet: { $sum: '$montantNet' },
          totalTTC: { $sum: '$montantTTC' },
          totalURSSAF: { $sum: '$taxeURSSAF' },
        }
      },
      { $sort: { '_id.year': 1 } }
    ]);

    console.log('annualStats renvoyés:', annualStats);
    res.json(annualStats);
  } catch (error) {
    console.error('Erreur lors de la récupération des stats annuelles:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des statistiques annuelles.' });
  }
});

// =======================
// /api/dashboard/top-clients
// =======================
router.get('/top-clients', async (req, res) => {
  try {
    const userId = req.user._id;
    const year = parseInt(req.query.year, 10);

    const match = {
      user: new mongoose.Types.ObjectId(userId),
      status: 'paid'
    };

    if (year) {
      match.createdAt = {
        $gte: new Date(year, 0, 1),
        $lte: new Date(year, 11, 31, 23, 59, 59)
      };
    }

    const topClients = await Facture.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$client', // on regroupe par client
          totalBrut: { $sum: '$montantHT' },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalBrut: -1 } },
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
          totalBrut: 1,
          count: 1,
        }
      }
    ]);

    console.log('topClients renvoyés:', topClients);
    res.json(topClients);
  } catch (error) {
    console.error('Erreur lors de la récupération des clients principaux:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la récupération des clients principaux.' });
  }
});

module.exports = router;
