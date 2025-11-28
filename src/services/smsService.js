const twilio = require('twilio');

class SMSService {
  constructor() {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    } else {
      console.warn('Twilio credentials not configured. SMS service will be disabled.');
      this.client = null;
    }
  }

  async sendSMS(to, message) {
    if (!this.client) {
      console.log('SMS (mock):', { to, message });
      return { success: true, mock: true };
    }

    try {
      const response = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: to
      });

      console.log('SMS sent:', response.sid);
      return { success: true, sid: response.sid };
    } catch (error) {
      console.error('SMS error:', error);
      throw error;
    }
  }

  async sendOTP(phoneNumber, otp) {
    const message = `Your Festivo verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendBookingConfirmation(phoneNumber, booking, event) {
    const message = `Festivo: Your booking for "${event.title}" on ${new Date(booking.eventDate).toLocaleDateString()} has been confirmed. Amount: ₹${booking.priceAgreed}`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendEventReminder(phoneNumber, event) {
    const message = `Festivo Reminder: "${event.title}" is tomorrow at ${event.time}. Location: ${event.locationName}`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendPaymentConfirmation(phoneNumber, amount, bookingId) {
    const message = `Festivo: Payment of ₹${amount} received for booking #${bookingId.toString().slice(-6)}. Thank you!`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendNewBookingAlert(phoneNumber, serviceName, organizerName) {
    const message = `Festivo: New booking request for "${serviceName}" from ${organizerName}. Login to review.`;
    return this.sendSMS(phoneNumber, message);
  }

  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }
}

module.exports = new SMSService();
