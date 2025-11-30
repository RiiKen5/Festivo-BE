const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    this.from = `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`;
  }

  async sendEmail(options) {
    const mailOptions = {
      from: this.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return info;
    } catch (error) {
      console.error('Email error:', error);
      throw error;
    }
  }

  async sendEmailVerification(user, verificationUrl) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">Verify Your Email</h1>
        <p>Hi ${user.name},</p>
        <p>Thank you for registering with Festivo! Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Verify Email
        </a>
        <p style="color: #666;">This link will expire in 24 hours.</p>
        <p>If you didn't create an account with Festivo, please ignore this email.</p>
        <p style="margin-top: 24px; color: #666;">
          Best regards,<br>
          The Festivo Team
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
        <p style="color: #999; font-size: 12px;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${verificationUrl}" style="color: #6366f1;">${verificationUrl}</a>
        </p>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Verify Your Email - Festivo',
      html
    });
  }

  async sendWelcomeEmail(user) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">Welcome to Festivo!</h1>
        <p>Hi ${user.name},</p>
        <p>Thank you for joining Festivo - your ultimate event planning platform!</p>
        <p>With Festivo, you can:</p>
        <ul>
          <li>Plan and organize amazing events</li>
          <li>Find trusted vendors and service providers</li>
          <li>Manage your event tasks efficiently</li>
          <li>Connect with attendees and vendors</li>
        </ul>
        <p>Get started by creating your first event or exploring our marketplace!</p>
        <a href="${process.env.FRONTEND_URL}/dashboard"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px;">
          Get Started
        </a>
        <p style="margin-top: 24px; color: #666;">
          Best regards,<br>
          The Festivo Team
        </p>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Welcome to Festivo!',
      html
    });
  }

  async sendPasswordResetEmail(user, resetUrl) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">Password Reset Request</h1>
        <p>Hi ${user.name},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666;">This link will expire in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <p style="margin-top: 24px; color: #666;">
          Best regards,<br>
          The Festivo Team
        </p>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: 'Password Reset - Festivo',
      html
    });
  }

  async sendBookingConfirmation(booking, organizer, vendor, service, event) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">Booking Confirmed!</h1>
        <p>Hi ${organizer.name},</p>
        <p>Your booking has been confirmed. Here are the details:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Service:</strong> ${service.serviceName}</p>
          <p><strong>Vendor:</strong> ${vendor.name}</p>
          <p><strong>Event:</strong> ${event.title}</p>
          <p><strong>Date:</strong> ${new Date(booking.eventDate).toLocaleDateString()}</p>
          <p><strong>Amount:</strong> ₹${booking.priceAgreed}</p>
        </div>
        <p>You can view and manage your booking from your dashboard.</p>
        <a href="${process.env.FRONTEND_URL}/bookings/${booking._id}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Booking
        </a>
      </div>
    `;

    return this.sendEmail({
      to: organizer.email,
      subject: 'Booking Confirmed - Festivo',
      html
    });
  }

  async sendEventReminder(rsvp, event) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">Event Reminder</h1>
        <p>Don't forget! You have an upcoming event:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <h2 style="color: #374151;">${event.title}</h2>
          <p><strong>Date:</strong> ${new Date(event.date).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${event.time}</p>
          <p><strong>Location:</strong> ${event.locationName}</p>
          <p><strong>Address:</strong> ${event.address}</p>
        </div>
        <a href="${process.env.FRONTEND_URL}/events/${event._id}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View Event Details
        </a>
      </div>
    `;

    return this.sendEmail({
      to: rsvp.attendee.email,
      subject: `Reminder: ${event.title} is coming up!`,
      html
    });
  }

  async sendNewBookingRequestToVendor(booking, organizer, service, event) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1;">New Booking Request</h1>
        <p>You have a new booking request!</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p><strong>Service:</strong> ${service.serviceName}</p>
          <p><strong>From:</strong> ${organizer.name}</p>
          <p><strong>Event:</strong> ${event.title}</p>
          <p><strong>Date:</strong> ${new Date(booking.eventDate).toLocaleDateString()}</p>
          <p><strong>Proposed Amount:</strong> ₹${booking.priceAgreed}</p>
        </div>
        <p>Please review and respond to this request as soon as possible.</p>
        <a href="${process.env.FRONTEND_URL}/bookings/${booking._id}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Review Request
        </a>
      </div>
    `;

    return this.sendEmail({
      to: service.provider.email,
      subject: 'New Booking Request - Festivo',
      html
    });
  }
}

module.exports = new EmailService();
