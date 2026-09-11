require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ical = require('ical-generator').default;
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ================================
// SUPABASE
// ================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ================================
// STRIPE
// ================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ================================
// RESEND
// ================================

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// ================================
// BASIC MIDDLEWARE
// ================================

app.use(cors());

// IMPORTANT:
// Stripe webhook must receive the raw body,
// so this route comes BEFORE express.json().

// ================================
// SEND CONFIRMATION EMAIL
// ================================

async function sendConfirmationEmail(booking) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'COORG Eco-Resort <onboarding@resend.dev>',
      to: [booking.customerEmail],
      subject: `Reservation Confirmed - COORG Eco-Resort (${booking.checkIn})`,
      html: `
        <div style="
          font-family: Arial, sans-serif;
          background-color: #0b110d;
          color: #f4f1de;
          padding: 30px;
          border-radius: 12px;
        ">

          <h2 style="color: #d4a373;">
            Reservation Confirmed 🎉
          </h2>

          <p>
            Dear <strong>${booking.customerName || 'Valued Guest'}</strong>,
          </p>

          <p>
            Thank you for choosing
            <strong>COORG Eco-Resort</strong>.
            Your reservation details are below:
          </p>

          <table style="
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            color: #f4f1de;
          ">

            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #333;">
                <strong>Check-in:</strong>
              </td>

              <td style="padding: 8px; border-bottom: 1px solid #333;">
                ${booking.checkIn}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #333;">
                <strong>Check-out:</strong>
              </td>

              <td style="padding: 8px; border-bottom: 1px solid #333;">
                ${booking.checkOut}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #333;">
                <strong>Guests:</strong>
              </td>

              <td style="padding: 8px; border-bottom: 1px solid #333;">
                ${booking.guests}
              </td>
            </tr>

            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #333;">
                <strong>Total Paid:</strong>
              </td>

              <td style="
                padding: 8px;
                border-bottom: 1px solid #333;
                color: #d4a373;
              ">
                <strong>
                  ₹${Number(booking.amountPaid).toLocaleString('en-IN')}
                </strong>
              </td>
            </tr>

          </table>

          <p>
            We look forward to hosting your escape into nature.
          </p>

          <hr style="border-color: #333;">

          <p style="
            font-size: 0.8rem;
            color: #a3b18a;
          ">
            COORG Eco-Resort | Private Sanctuary
          </p>

        </div>
      `
    });

    if (error) {
      console.error('Failed to send email:', error);
      return;
    }

    console.log(
      `Confirmation email sent to ${booking.customerEmail}`
    );

  } catch (err) {
    console.error('Failed to send email:', err);
  }
}

// ================================
// SAVE BOOKING TO SUPABASE
// ================================

async function saveBookingToDatabase(bookingData) {

  console.log('=================================');
  console.log('Attempting to save booking to Supabase...');
  console.log('Booking ID:', bookingData.bookingId);
  console.log('Customer:', bookingData.customerName);
  console.log('Amount:', bookingData.amountPaid);
  console.log('=================================');

  const { data, error } = await supabase
    .from('bookings')
    .insert([
      {
        booking_id: bookingData.bookingId,
        customer_email: bookingData.customerEmail,
        customer_name: bookingData.customerName,
        amount_paid: bookingData.amountPaid,
        currency: bookingData.currency,
        property_id: bookingData.propertyId,
        check_in: bookingData.checkIn,
        check_out: bookingData.checkOut,
        guests: String(bookingData.guests),
        booked_at:
          bookingData.bookedAt || new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    console.error(
      'BOOKING SAVE FAILED:',
      error.message
    );

    return false;
  }

  console.log('=================================');
  console.log('BOOKING SAVED TO SUPABASE');
  console.log('Booking ID:', bookingData.bookingId);
  console.log('=================================');

  return true;
}

// ================================
// STRIPE WEBHOOK
// ================================

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {

    const sig = req.headers['stripe-signature'];

    let event;

    try {

      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.WEBHOOK_SECRET
      );

    } catch (err) {

      console.error(
        'Webhook Signature Verification Failed:',
        err.message
      );

      return res
        .status(400)
        .send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {

      try {

        const session = event.data.object;

        const newBooking = {
          bookingId: session.id,

          customerEmail:
            session.customer_details?.email || '',

          customerName:
            session.customer_details?.name || 'Guest',

          amountPaid:
            session.amount_total / 100,

          currency:
            session.currency
              ? session.currency.toUpperCase()
              : 'INR',

          propertyId:
            session.metadata?.propertyId || '',

          checkIn:
            session.metadata?.checkIn || '',

          checkOut:
            session.metadata?.checkOut || '',

          guests:
            session.metadata?.guests || '1',

          bookedAt:
            new Date().toISOString()
        };

        // Save booking ONLY ONCE
        await saveBookingToDatabase(newBooking);

        // Send confirmation email
        await sendConfirmationEmail(newBooking);

      } catch (err) {

        console.error(
          'Webhook booking processing error:',
          err
        );

        return res
          .status(500)
          .json({
            error: 'Booking processing failed.'
          });
      }
    }

    res.json({
      received: true
    });
  }
);

// ================================
// JSON MIDDLEWARE
// ================================

app.use(express.json());

// ================================
// TEST ROUTE
// ================================

app.get('/api/test', (req, res) => {

  res.json({
    message: 'Backend is connected!'
  });

});

// ================================
// STATIC WEBSITE FILES
// ================================

app.use(express.static(__dirname));

// ================================
// PROPERTY DATA
// ================================

const PROPERTY_DATA = {

  'canopy-loft': {

    name: 'Coorg Eco-Resort',

    nightlyRate: 2700,

    cleaningFee: 500,

    taxRate: 0.18,

    extraGuestFee: 500

  }

};

// ================================
// CREATE STRIPE CHECKOUT SESSION
// ================================

app.post(
  '/api/create-checkout-session',
  async (req, res) => {

    try {

      const {
        propertyId,
        checkIn,
        checkOut,
        guests
      } = req.body;

      // ----------------------------
      // Validate required fields
      // ----------------------------

      if (
        !propertyId ||
        !checkIn ||
        !checkOut ||
        !guests
      ) {

        return res.status(400).json({
          error:
            'Missing required booking details.'
        });

      }

      // ----------------------------
      // Find property
      // ----------------------------

      const property =
        PROPERTY_DATA[propertyId];

      if (!property) {

        return res.status(404).json({
          error: 'Property not found.'
        });

      }

      // ----------------------------
      // Validate guests
      // ----------------------------

      const parsedGuests =
        parseInt(guests, 10);

      if (
        isNaN(parsedGuests) ||
        parsedGuests < 1 ||
        parsedGuests > 10
      ) {

        return res.status(400).json({
          error:
            'Invalid guest count. Allowed range is 1 to 10 guests.'
        });

      }

      // ----------------------------
      // Validate dates
      // ----------------------------

      const startDate =
        new Date(checkIn);

      const endDate =
        new Date(checkOut);

      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0
      );

      if (
        isNaN(startDate.getTime()) ||
        isNaN(endDate.getTime())
      ) {

        return res.status(400).json({
          error:
            'Invalid date format provided.'
        });

      }

      if (startDate < today) {

        return res.status(400).json({
          error:
            'Check-in date cannot be in the past.'
        });

      }

      const nights =
        Math.ceil(
          (endDate - startDate) /
          (1000 * 60 * 60 * 24)
        );

      if (nights <= 0) {

        return res.status(400).json({
          error:
            'Check-out date must be after check-in date.'
        });

      }

      // ----------------------------
      // CHECK DOUBLE BOOKINGS
      // ----------------------------

      const {
        data: existingBookings,
        error: bookingCheckError
      } = await supabase
        .from('bookings')
        .select(
          'check_in, check_out'
        );

      if (bookingCheckError) {

        console.error(
          'Could not check existing bookings:',
          bookingCheckError.message
        );

        return res.status(500).json({
          error:
            'Could not check booking availability.'
        });

      }

      const isOverlap =
        existingBookings.some(
          booking => {

            const existingStart =
              new Date(
                booking.check_in
              );

            const existingEnd =
              new Date(
                booking.check_out
              );

            return (
              startDate < existingEnd &&
              endDate > existingStart
            );

          }
        );

      if (isOverlap) {

        return res.status(409).json({
          error:
            'Selected dates overlap with an existing reservation.'
        });

      }

      // ----------------------------
      // PRICING
      // ----------------------------

      const guestSurcharge =
        parsedGuests > 2
          ? (parsedGuests - 2) *
            property.extraGuestFee
          : 0;

      const nightlyPrice =
        property.nightlyRate +
        guestSurcharge;

      // ----------------------------
      // CREATE STRIPE SESSION
      // ----------------------------

      const session =
        await stripe.checkout.sessions.create({

          payment_method_types: [
            'card'
          ],

          line_items: [

            {
              price_data: {

                currency: 'inr',

                product_data: {

                  name:
                    `${property.name} (${nights} Night Stay)`,

                  description:
                    `Check-in: ${checkIn} | Check-out: ${checkOut} | Guests: ${parsedGuests}`

                },

                unit_amount:
                  Math.round(
                    nightlyPrice * 100
                  )

              },

              quantity: nights

            },

            {
              price_data: {

                currency: 'inr',

                product_data: {

                  name:
                    'Cleaning & Sanitation Fee'

                },

                unit_amount:
                  Math.round(
                    property.cleaningFee * 100
                  )

              },

              quantity: 1

            }

          ],

          mode: 'payment',

          success_url:
            `https://coorg-premium-stay-4.onrender.com/success.html?session_id={CHECKOUT_SESSION_ID}`,

          cancel_url:
            `https://coorg-premium-stay-4.onrender.com/index.html`,

          metadata: {

            propertyId,

            checkIn,

            checkOut,

            guests:
              parsedGuests.toString()

          }

        });

      // ----------------------------
      // SEND CHECKOUT URL
      // ----------------------------

      res.json({
        url: session.url
      });

    } catch (error) {

      console.error(
        'Stripe Error:',
        error
      );

      res.status(500).json({
        error:
          'Failed to process payment request. Please try again.'
      });

    }

  }
);

// ================================
// ADMIN BOOKINGS
// ================================

app.get(
  '/api/admin/bookings',
  async (req, res) => {

    console.log(
      'ADMIN BOOKINGS ROUTE HIT'
    );

    try {

      const {
        data,
        error
      } = await supabase
        .from('bookings')
        .select('*')
        .order(
          'check_in',
          {
            ascending: true
          }
        );

      if (error) {

        console.error(
          'Could not load admin bookings from Supabase:',
          error.message
        );

        return res.status(500).json({
          error:
            'Could not load bookings.'
        });

      }

      res.json(data);

    } catch (err) {

      console.error(
        'Admin bookings error:',
        err.message
      );

      res.status(500).json({
        error:
          'Could not load bookings.'
      });

    }

  }
);

// ================================
// CALENDAR EXPORT
// ================================

app.get(
  '/api/calendar.ics',
  async (req, res) => {

    try {

      console.log(
        'CALENDAR EXPORT ROUTE HIT'
      );

      const {
        data: bookings,
        error
      } = await supabase
        .from('bookings')
        .select('*')
        .order(
          'check_in',
          {
            ascending: true
          }
        );

      if (error) {

        console.error(
          'Could not load calendar bookings from Supabase:',
          error.message
        );

        return res
          .status(500)
          .send(
            'Could not load bookings.'
          );

      }

      const calendar =
        ical({
          name:
            'COORG Homestay Bookings'
        });

      bookings.forEach(
        booking => {

          calendar.createEvent({

            start:
              new Date(
                booking.check_in
              ),

            end:
              new Date(
                booking.check_out
              ),

            summary:
              `Reserved: ${booking.customer_name || 'Guest'}`,

            description:
              `Direct Booking via Website (${booking.guests} Guests)`

          });

        }
      );

      res.writeHead(
        200,
        {

          'Content-Type':
            'text/calendar; charset=utf-8',

          'Content-Disposition':
            'attachment; filename="calendar.ics"'

        }
      );

      res.end(
        calendar.toString()
      );

    } catch (err) {

      console.error(
        'Calendar export error:',
        err.message
      );

      res
        .status(500)
        .send(
          'Could not create calendar.'
        );

    }

  }
);

// ================================
// GET BOOKED DATES
// ================================

app.get(
  '/api/booked-dates',
  async (req, res) => {

    console.log(
      'BOOKED DATES ROUTE HIT'
    );

    try {

      const {
        data,
        error
      } = await supabase
        .from('bookings')
        .select(
          'check_in, check_out'
        )
        .order(
          'check_in',
          {
            ascending: true
          }
        );

      if (error) {

        console.error(
          'Could not load booked dates from Supabase:',
          error.message
        );

        return res.status(500).json({
          error:
            'Could not load booked dates.'
        });

      }

      const bookedRanges =
        data.map(
          row => ({

            checkIn:
              row.check_in,

            checkOut:
              row.check_out

          })
        );

      console.log(
        'BOOKED RANGES FROM SUPABASE:',
        bookedRanges
      );

      res.json(
        bookedRanges
      );

    } catch (err) {

      console.error(
        'Booked dates error:',
        err.message
      );

      res.status(500).json({
        error:
          'Could not load booked dates.'
      });

    }

  }
);

// ================================
// 404 ROUTE
// ================================

app.use(
  (req, res) => {

    res.status(404).json({
      error:
        'API endpoint not found.'
    });

  }
);

// ================================
// START SERVER
// ================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {

    console.log(
      `Server running on http://localhost:${PORT}`
    );

  }
);
