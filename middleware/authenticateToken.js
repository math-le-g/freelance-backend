const jwt = require('jsonwebtoken');
const { promisify } = require('util');

const jwtVerify = promisify(jwt.verify);

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    //console.log('Header Authorization brut:', authHeader);

    

    if (!authHeader) {
      console.log('Token manquant');
      return res.status(401).json({ message: 'Token manquant' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.log('Format de token invalide');
      return res.status(401).json({ message: 'Format de token invalide' });
    }

    const token = authHeader.split(' ')[1];
    // console.log('Token extrait:', token);

    try {
      const user = await jwtVerify(token, process.env.JWT_SECRET);
      //console.log('Token validé avec succès - Utilisateur:', user._id);
      req.user = user;
      next();
    } catch (err) {
      console.error('Erreur JWT:', err.message);
      return res.status(403).json({ message: 'Token invalide' });
    }
  } catch (error) {
    console.error('Erreur inattendue:', error);
    return res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = authenticateToken;

