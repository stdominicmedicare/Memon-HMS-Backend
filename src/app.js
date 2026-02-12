import express from 'express';
import cors from 'cors';

const app = express();

// CORS: allow multiple origins (comma-separated in FRONTEND_URL)
// e.g. FRONTEND_URL=https://localhost:5173,https://192.168.100.7:5173,http://localhost:5173,http://192.168.100.7:5173
const frontendUrls = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
app.use(cors({
  origin: frontendUrls,
  credentials: true,
  optionsSuccessStatus: 204,
}));
if (process.env.NODE_ENV !== 'test') {
  console.log('CORS allowed origins:', frontendUrls);
}
app.use(express.json());

// Health / API root
app.get('/', (req, res) => {
  res.json({
    message: 'Hospital Management System API',
    status: 'ok',
    version: '0.0.1',
  });
});
app.get('/api', (req, res) => {
  res.json({ message: 'API root', status: 'ok' });
});

// Auth: current user profile (no role required) – avoids frontend profile timeout
import authRoutes from './routes/auth.routes.js';
import adminRoutes from './routes/admin.routes.js';
import patientRoutes from './routes/patient.routes.js';
import doctorRoutes from './routes/doctor.routes.js';
import ambulanceRoutes from './routes/ambulance.routes.js';
import icuRoutes from './routes/icu.routes.js';
import pharmacyRoutes from './routes/pharmacy.routes.js';
import bloodbankRoutes from './routes/bloodbank.routes.js';

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/ambulance', ambulanceRoutes);
app.use('/api/icu', icuRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/bloodbank', bloodbankRoutes);

export default app;
