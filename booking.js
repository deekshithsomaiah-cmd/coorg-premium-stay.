// ===============================
// BOOKING STATE
// ===============================

const BOOKING_STATE = {
  propertyId: "canopy-loft",
  nightlyRate: 14999,
  cleaningFee: 4000,
  taxRate: 0.18,
  checkIn: null,
  checkOut: null,
  guests: 2
};


// ===============================
// DOM ELEMENTS
// ===============================

const datePicker = document.getElementById("date-picker");
const guestSelect = document.getElementById("guest-select");
const priceSummary = document.getElementById("price-summary");
const bookBtn = document.getElementById("book-now-btn");


// ===============================
// DATE RANGE PICKER
// ===============================

if (datePicker) {

  flatpickr(datePicker, {
    mode: "range",
    minDate: "today",
    dateFormat: "Y-m-d",
    allowInput: false,

    onChange: function(selectedDates) {

      // Need two dates
      if (selectedDates.length !== 2) {
        return;
      }

      const checkIn = selectedDates[0];
      const checkOut = selectedDates[1];

      BOOKING_STATE.checkIn = formatDate(checkIn);
      BOOKING_STATE.checkOut = formatDate(checkOut);

      updatePricing();
    }
  });

}


// ===============================
// FORMAT DATE
// ===============================

function formatDate(date) {

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


// ===============================
// CALCULATE NIGHTS
// ===============================

function calculateNights(start, end) {

  const startDate = new Date(start);
  const endDate = new Date(end);

  const difference = endDate - startDate;

  return Math.ceil(
    difference / (1000 * 60 * 60 * 24)
  );
}


// ===============================
// UPDATE PRICE
// ===============================

function updatePricing() {

  if (!BOOKING_STATE.checkIn || !BOOKING_STATE.checkOut) {
    return;
  }

  const nights = calculateNights(
    BOOKING_STATE.checkIn,
    BOOKING_STATE.checkOut
  );

  if (nights <= 0) {

    alert("Check-out date must be after check-in date.");

    BOOKING_STATE.checkIn = null;
    BOOKING_STATE.checkOut = null;

    if (priceSummary) {
      priceSummary.classList.add("hidden");
    }

    if (bookBtn) {
      bookBtn.disabled = true;
    }

    return;
  }


  // ===============================
  // GUESTS
  // ===============================

  let guests = 2;

  if (guestSelect) {
    guests = parseInt(guestSelect.value, 10) || 2;
  }

  BOOKING_STATE.guests = guests;


  // ===============================
  // EXTRA GUEST FEE
  // ===============================

  const extraGuestFee = 1500;

  const extraGuests =
    Math.max(0, guests - 2);

  const guestSurcharge =
    extraGuests * extraGuestFee;


  // ===============================
  // PRICE CALCULATION
  // ===============================

  const nightlyPrice =
    BOOKING_STATE.nightlyRate + guestSurcharge;

  const subtotal =
    nights * nightlyPrice;

  const tax =
    subtotal * BOOKING_STATE.taxRate;

  const total =
    subtotal +
    BOOKING_STATE.cleaningFee +
    tax;


  // ===============================
  // DISPLAY PRICE
  // ===============================

  const nightRateLabel =
    document.getElementById("night-rate-label");

  const subtotalAmount =
    document.getElementById("subtotal-amount");

  const taxAmount =
    document.getElementById("tax-amount");

  const totalAmount =
    document.getElementById("total-amount");


  if (nightRateLabel) {
    nightRateLabel.innerText =
      `₹${nightlyPrice.toFixed(0)} × ${nights} night${nights > 1 ? "s" : ""}`;
  }

  if (subtotalAmount) {
    subtotalAmount.innerText =
      `₹${subtotal.toFixed(2)}`;
  }

  if (taxAmount) {
    taxAmount.innerText =
      `₹${tax.toFixed(2)}`;
  }

  if (totalAmount) {
    totalAmount.innerText =
      `₹${total.toFixed(2)}`;
  }


  // ===============================
  // SHOW SUMMARY
  // ===============================

  if (priceSummary) {
    priceSummary.classList.remove("hidden");
  }

  if (bookBtn) {
    bookBtn.disabled = false;
  }
}


// ===============================
// GUEST CHANGE
// ===============================

if (guestSelect) {

  guestSelect.addEventListener("change", function() {

    BOOKING_STATE.guests =
      parseInt(this.value, 10) || 2;

    updatePricing();

  });

}


// ===============================
// STRIPE PAYMENT
// ===============================

if (bookBtn) {

  bookBtn.addEventListener("click", async function() {

    if (
      !BOOKING_STATE.checkIn ||
      !BOOKING_STATE.checkOut
    ) {

      alert("Please select your check-in and check-out dates.");

      return;
    }


    bookBtn.disabled = true;
    bookBtn.innerText = "Processing...";


    try {

      const response = await fetch(
        "http://localhost:3000/api/create-checkout-session",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json"
          },

          body: JSON.stringify(BOOKING_STATE)
        }
      );


      const data = await response.json();


      if (!response.ok) {

        throw new Error(
          data.error || "Payment session could not be created."
        );

      }


      if (data.url) {

        window.location.href = data.url;

      } else {

        throw new Error(
          "Stripe checkout URL was not returned."
        );

      }

    } catch (error) {

      console.error(
        "Payment initiation failed:",
        error
      );

      alert(
        "Could not connect to the payment backend server."
      );

      bookBtn.disabled = false;
      bookBtn.innerText = "Proceed to Payment";

    }

  });

}