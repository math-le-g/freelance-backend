// backend/controllers/authController.js

const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Générer un token JWT
const generateToken = (user) => {
  return jwt.sign(
    {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    process.env.JWT_SECRET,
    { expiresIn: '12h' } // Le token expire dans 12 heure
  );
};

// Contrôleur pour l'inscription
exports.signup = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Vérifier si l'utilisateur existe déjà
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'Un utilisateur avec cet email existe déjà.' });
    }

    // Créer un nouvel utilisateur
    user = new User({
      firstName,
      lastName,
      email,
      password, // Assurez-vous que le mot de passe est haché dans le modèle User via un middleware
    });

    await user.save();

    // Générer un token
    const token = generateToken(user);

    // Retourner la réponse
    res.status(201).json({
      message: 'Utilisateur inscrit avec succès.',
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Erreur lors de l\'inscription :', error);
    res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
  }
};

// Contrôleur pour la connexion
exports.signin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Trouver l'utilisateur par email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // Vérifier le mot de passe (assurez-vous d'avoir une méthode de comparaison dans votre modèle User)
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // Générer un token
    const token = generateToken(user);

    // Retourner la réponse
    res.status(200).json({
      message: 'Connexion réussie.',
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Erreur lors de la connexion :', error);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
};

// Contrôleur pour la validation du token
exports.validateToken = async (req, res) => {
  try {
    // Le middleware `authenticateToken` a déjà vérifié le token et ajouté `req.user`
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.', code: 'USER_NOT_FOUND' });
    }

    res.status(200).json({ valid: true, user });
  } catch (error) {
    console.error('Erreur lors de la validation du token :', error);
    res.status(500).json({ message: 'Erreur serveur lors de la validation du token.' });
  }
};


