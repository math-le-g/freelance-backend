const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const BillingSettingsSchema = new mongoose.Schema({
  
});

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true, 
  },
  password: {
    type: String,
    required: true,
  },
  billingSettings: BillingSettingsSchema
}, {
  timestamps: true, // Ajoute createdAt et updatedAt automatiquement
});

// Middleware pour hacher le mot de passe avant de le sauvegarder
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

// Méthode pour comparer le mot de passe
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

