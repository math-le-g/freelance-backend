const express = require('express');
const router = express.Router();
const { signup, signin, validateToken } = require('../controllers/authController');
const { body, validationResult } = require('express-validator');
const authenticateToken = require('../middleware/authenticateToken');

// Validation pour l'inscription
const validateSignup = [
  body('firstName').isString().withMessage('Le prénom est requis.'),
  body('lastName').isString().withMessage('Le nom est requis.'),
  body('email').isEmail().withMessage('Email invalide.'),
  body('password').isLength({ min: 2 }).withMessage('Le mot de passe doit comporter au moins 6 caractères.'),
];

// Validation pour la connexion
const validateSignin = [
  body('email').isEmail().withMessage('Email invalide.'),
  body('password').exists().withMessage('Le mot de passe est requis.'),
];

// Route d'inscription
router.post('/signup', validateSignup, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }
  await signup(req, res);
});

// Route de connexion
router.post('/signin', validateSignin, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation échouée.', errors: errors.array() });
  }
  await signin(req, res);
});

// Route de validation du token
router.post('/validate-token', authenticateToken, validateToken);

module.exports = router;


