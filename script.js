document.addEventListener('DOMContentLoaded', () => {
  // Global Pricing Constants
  const BASE_NIGHTLY_RATE = 2700;
  const CLEANING_FEE = 500;
  const EXTRA_GUEST_FEE = 500;
  const TAX_RATE = 0.18;

  // Track Active Selection
  let selectedCheckIn = null;
  let selectedCheckOut = null;
  let calculatedNights = 0;

  // DOM Elements
  const dateInput = document.getElementById('date-picker');
  const guestSelect = document.getElementById('guests');
  const bookBtn = document.getElementById('book-now-btn');
  const priceSummary = document.getElementById('price-summary');

  const nightRateLabel = document.getElementById('night-rate-label');
  const subtotalAmount = document.getElementById('subtotal-amount');
  const cleaningFeeEl = document.getElementById('cleaning-fee');
  const taxAmountEl = document.getElementById('tax-amount');
  const totalAmountEl = document.getElementById('total-amount');
  const extraGuestRow = document.getElementById('extra-guest-row');
  const extraGuestFeeEl = document.getElementById('extra-guest-fee');

  // Unified Price Calculation Engine
  function updatePriceBreakdown() {
    if (calculatedNights <= 0) return;

    const guests = parseInt(guestSelect.value, 10) || 1;
    const basePrice = calculatedNights * BASE_NIGHTLY_RATE;
    const extraGuestSurcharge = guests > 2 ? (guests - 2) * EXTRA_GUEST_FEE * calculatedNights : 0;
    
    const taxableSubtotal = basePrice + extraGuestSurcharge + CLEANING_FEE;
    const tax = Math.round(taxableSubtotal * TAX_RATE);
    const total = taxableSubtotal + tax;

    // Update UI text values
    nightRateLabel.innerText = `₹${BASE_NIGHTLY_RATE.toLocaleString('en-IN')} × ${calculatedNights} night${calculatedNights > 1 ? 's' : ''}`;
    subtotalAmount.innerText = `₹${basePrice.toLocaleString('en-IN')}`;

    if (extraGuestRow && extraGuestFeeEl) {
      if (extraGuestSurcharge > 0) {
        extraGuestRow.classList.remove('hidden');
        extraGuestFeeEl.innerText = `₹${extraGuestSurcharge.toLocaleString('en-IN')}`;
      } else {
        extraGuestRow.classList.add('hidden');
      }
    }

    cleaningFeeEl.innerText = `₹${CLEANING_FEE.toLocaleString('en-IN')}`;
    taxAmountEl.innerText = `₹${tax.toLocaleString('en-IN')}`;
    totalAmountEl.innerText = `₹${total.toLocaleString('en-IN')}`;
  }

  // Initialize Flatpickr Calendar
  const fp = flatpickr("#date-picker", {
    mode: "range",
    minDate: "today",
    dateFormat: "Y-m-d",
    onChange: function (selectedDates) {
      if (selectedDates.length === 2) {
        selectedCheckIn = formatDate(selectedDates[0]);
        selectedCheckOut = formatDate(selectedDates[1]);

        const diffTime = Math.abs(selectedDates[1] - selectedDates[0]);
        calculatedNights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        priceSummary.classList.remove('hidden');
        bookBtn.disabled = false;
        bookBtn.innerText = "Proceed to Payment";
        updatePriceBreakdown();
      } else {
        selectedCheckIn = null;
        selectedCheckOut = null;
        calculatedNights = 0;
        priceSummary.classList.add('hidden');
        bookBtn.disabled = true;
        bookBtn.innerText = "Select Dates to Book";
      }
    }
  });

  // Fetch blocked dates and update calendar instance
  fetch('https://coorg-premium-stay-4.onrender.com/api/booked-dates')
    .then(res => res.json())
    .then(bookedRanges => {
   const disabledDates = bookedRanges.flatMap(range => {
  const dates = [];
  let current = new Date(range.checkIn);
  const end = new Date(range.checkOut);

  while (current < end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
});
      
      fp.set('disable', disabledDates);
      console.log("DISABLED DATES:", disabledDates);
    })
    .catch(err => console.error('Could not load booked dates:', err));

  // Recalculate if guest count changes
  if (guestSelect) {
    guestSelect.addEventListener('change', updatePriceBreakdown);
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Handle Checkout Click
  bookBtn.addEventListener('click', async () => {
   if (!selectedCheckIn || !selectedCheckOut || !guestSelect.value) {
  alert("Please select the number of guests.");
  return;
}

    bookBtn.innerText = "Processing Reservation...";
    bookBtn.disabled = true;

    try {
      const response = await fetch('https://coorg-premium-stay.onrender.com/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: 'canopy-loft',
          checkIn: selectedCheckIn,
          checkOut: selectedCheckOut,
          guests: parseInt(guestSelect.value, 10)
        })
      });

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Booking failed: ' + (data.error || 'Unknown error'));
        bookBtn.disabled = false;
        bookBtn.innerText = "Proceed to Payment";
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Could not connect to payment backend server.');
      bookBtn.disabled = false;
      bookBtn.innerText = "Proceed to Payment";
    }
  });
});