require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ical = require('ical-generator').default;
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Configure Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Function to Send Email Receipts
async function sendConfirmationEmail(booking) {
  const mailOptions = {
    from: `"COORG Eco-Resort" <${process.env.EMAIL_USER}>`,
    to: booking.customerEmail,
    subject: `Reservation Confirmed - COORG Eco-Resort (${booking.checkIn})`,
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #0b110d; color: #f4f1de; padding: 30px; border-radius: 12px;">
        <h2 style="color: #d4a373;">Reservation Confirmed 🎉</h2>
        <p>Dear <strong>${booking.customerName || 'Valued Guest'}</strong>,</p>
        <p>Thank you for choosing <strong>COORG Eco-Resort</strong>. Your reservation details are below:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; color: #f4f1de;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Check-in:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${booking.checkIn}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Check-out:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${booking.checkOut}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Guests:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333;">${booking.guests}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #333;"><strong>Total Paid:</strong></td><td style="padding: 8px; border-bottom: 1px solid #333; color: #d4a373;"><strong>₹${booking.amountPaid.toLocaleString('en-IN')}</strong></td></tr>
        </table>

        <p>We look forward to hosting your escape into nature.</p>
        <hr style="border-color: #333;">
        <p style="font-size: 0.8rem; color: #a3b18a;">COORG Eco-Resort | Private Sanctuary</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Confirmation email sent to ${booking.customerEmail}`);
  } catch (err) {
    console.error('Failed to send email:', err);
  }
}

// Stripe Webhook Endpoint
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook Signature Verification Failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const newBooking = {
      bookingId: session.id,
      customerEmail: session.customer_details.email,
      customerName: session.customer_details.name,
      amountPaid: session.amount_total / 100,
      currency: session.currency.toUpperCase(),
      propertyId: session.metadata.propertyId,
      checkIn: session.metadata.checkIn,
      checkOut: session.metadata.checkOut,
      guests: session.metadata.guests,
      bookedAt: new Date().toISOString()
    };

    saveBookingToDatabase(newBooking);
    sendConfirmationEmail(newBooking); // Send email automatically
  }
  res.json({ received: true });
});

// Catch-all route for undefined endpoints
app.use((req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack);
  res.status(500).json({ error: "Internal Server Error." });
});

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const PROPERTY_DATA = {
  "canopy-loft": {
    name: "Coorg Eco-Resort",
    nightlyRate: 2700,
    cleaningFee: 500,
    taxRate: 0.18,
    extraGuestFee: 500
  }
};


function saveBookingToDatabase(bookingData) {
  const filePath = path.join(__dirname, 'bookings.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    let bookings = [];
    if (!err && data) {
      try { bookings = JSON.parse(data); } catch (e) { bookings = []; }
    }
    bookings.push(bookingData);
    fs.writeFile(filePath, JSON.stringify(bookings, null, 2), (err) => {
      if (!err) console.log(`Saved new booking: ${bookingData.bookingId}`);
    });
  });
}

// Enhanced Checkout Endpoint with Input Validation
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { propertyId, checkIn, checkOut, guests } = req.body;

    // Validate presence of required fields
    if (!propertyId || !checkIn || !checkOut || !guests) {
      return res.status(400).json({ error: "Missing required booking details." });
    }

    const property = PROPERTY_DATA[propertyId];
    if (!property) {
      return res.status(404).json({ error: "Property not found." });
    }

    // Validate guest count
    const parsedGuests = parseInt(guests, 10);
    if (isNaN(parsedGuests) || parsedGuests < 1 || parsedGuests > 10) {
      return res.status(400).json({ error: "Invalid guest count. Allowed range is 1 to 10 guests." });
    }

    // Validate dates
    const startDate = new Date(checkIn);
    const endDate = new Date(checkOut);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format provided." });
    }

    if (startDate < today) {
      return res.status(400).json({ error: "Check-in date cannot be in the past." });
    }

    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    if (nights <= 0) {
      return res.status(400).json({ error: "Check-out date must be after check-in date." });
    }

    // Check for double bookings against stored reservations
    const filePath = path.join(__dirname, 'bookings.json');
    if (fs.existsSync(filePath)) {
      const rawData = fs.readFileSync(filePath, 'utf8');
      const existingBookings = rawData ? JSON.parse(rawData) : [];
      
      const isOverlap = existingBookings.some(b => {
        const existingStart = new Date(b.checkIn);
        const existingEnd = new Date(b.checkOut);
        return startDate < existingEnd && endDate > existingStart;
      });

      if (isOverlap) {
        return res.status(409).json({ error: "Selected dates overlap with an existing reservation." });
      }
    }

    // Pricing calculation
    const guestSurcharge = parsedGuests > 2 ? (parsedGuests - 2) * property.extraGuestFee : 0;
    const nightlyPrice = property.nightlyRate + guestSurcharge;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: `${property.name} (${nights} Night Stay)`,
              description: `Check-in: ${checkIn} | Check-out: ${checkOut} | Guests: ${parsedGuests}`
            },
            unit_amount: Math.round(nightlyPrice * 100)
          },
          quantity: nights
        },
        {
          price_data: {
            currency: 'inr',
            product_data: { name: 'Cleaning & Sanitation Fee' },
            unit_amount: Math.round(property.cleaningFee * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `http://127.0.0.1:5500/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://127.0.0.1:5500/index.html`,
      metadata: { 
        propertyId, 
        checkIn, 
        checkOut, 
        guests: parsedGuests.toString() 
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Error:', error);
    res.status(500).json({ error: "Failed to process payment request. Please try again." });
  }
});// Enhanced Checkout Endpoint with Input Validation
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { propertyId, checkIn, checkOut, guests } = req.body;

    // Validate presence of required fields
    if (!propertyId || !checkIn || !checkOut || !guests) {
      return res.status(400).json({ error: "Missing required booking details." });
    }

    const property = PROPERTY_DATA[propertyId];
    if (!property) {
      return res.status(404).json({ error: "Property not found." });
    }

    // Validate guest count
    const parsedGuests = parseInt(guests, 10);
    if (isNaN(parsedGuests) || parsedGuests < 1 || parsedGuests > 10) {
      return res.status(400).json({ error: "Invalid guest count. Allowed range is 1 to 10 guests." });
    }

    // Validate dates
    const startDate = new Date(checkIn);
    const endDate = new Date(checkOut);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format provided." });
    }

    if (startDate < today) {
      return res.status(400).json({ error: "Check-in date cannot be in the past." });
    }

    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    if (nights <= 0) {
      return res.status(400).json({ error: "Check-out date must be after check-in date." });
    }

    // Check for double bookings against stored reservations
    const filePath = path.join(__dirname, 'bookings.json');
    if (fs.existsSync(filePath)) {
      const rawData = fs.readFileSync(filePath, 'utf8');
      const existingBookings = rawData ? JSON.parse(rawData) : [];
      
      const isOverlap = existingBookings.some(b => {
        const existingStart = new Date(b.checkIn);
        const existingEnd = new Date(b.checkOut);
        return startDate < existingEnd && endDate > existingStart;
      });

      if (isOverlap) {
        return res.status(409).json({ error: "Selected dates overlap with an existing reservation." });
      }
    }

    // Pricing calculation
    const guestSurcharge = parsedGuests > 2 ? (parsedGuests - 2) * property.extraGuestFee : 0;
    const nightlyPrice = property.nightlyRate + guestSurcharge;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'inr',
            product_data: {
              name: `${property.name} (${nights} Night Stay)`,
              description: `Check-in: ${checkIn} | Check-out: ${checkOut} | Guests: ${parsedGuests}`
            },
            unit_amount: Math.round(nightlyPrice * 100)
          },
          quantity: nights
        },
        {
          price_data: {
            currency: 'inr',
            product_data: { name: 'Cleaning & Sanitation Fee' },
            unit_amount: Math.round(property.cleaningFee * 100)
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `http://127.0.0.1:5500/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://127.0.0.1:5500/index.html`,
      metadata: { 
        propertyId, 
        checkIn, 
        checkOut, 
        guests: parsedGuests.toString() 
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe Error:', error);
    res.status(500).json({ error: "Failed to process payment request. Please try again." });
  }
});

app.get('/api/admin/bookings', (req, res) => {
  const filePath = path.join(__dirname, 'bookings.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err || !data) return res.json([]);
    try { res.json(JSON.parse(data)); } catch (e) { res.json([]); }
  });
});

app.get('/api/calendar.ics', (req, res) => {
  const filePath = path.join(__dirname, 'bookings.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    const calendar = ical({ name: 'COORG Homestay Bookings' });
    if (!err && data) {
      try {
        const bookings = JSON.parse(data);
        bookings.forEach(b => {
          calendar.createEvent({
            start: new Date(b.checkIn),
            end: new Date(b.checkOut),
            summary: `Reserved: ${b.customerName || 'Guest'}`,
            description: `Direct Booking via Website (${b.guests} Guests)`
          });
        });
      } catch (e) {}
    }
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="calendar.ics"',
    });
    res.end(calendar.toString());
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
app.get('/api/booked-dates', (req, res) => {
  const filePath = path.join(__dirname, 'bookings.json');
  if (!fs.existsSync(filePath)) {
    return res.json([]);
  }
  
  const rawData = fs.readFileSync(filePath, 'utf8');
  const bookings = rawData ? JSON.parse(rawData) : [];
  
  // Return list of booked date ranges
  const bookedRanges = bookings.map(b => ({
    checkIn: b.checkIn,
    checkOut: b.checkOut
  }));

  res.json(bookedRanges);
});