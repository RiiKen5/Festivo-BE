const { frontendUrl } = require('../config/frontend');
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
      },
      // Signup waits for the verification email, so fail fast instead of
      // nodemailer's 2-minute default when the mail server is unreachable
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000
    });

    this.from = `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`;
  }

  isConfigured() {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  // Resolves to null when nothing was sent, so callers can tell the user
  async sendEmail(options) {
    // Without SMTP settings (local dev, tests) log instead of attempting delivery
    if (!this.isConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        console.error(`[email NOT sent: SMTP_HOST/SMTP_USER/SMTP_PASS missing] subject="${options.subject}"`);
      } else if (process.env.NODE_ENV !== 'test') {
        console.log(`[email not sent: SMTP not configured] to=${options.to} subject="${options.subject}"`);
      }
      return null;
    }

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
        <a href="${frontendUrl()}/dashboard"
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
        <a href="${frontendUrl()}/bookings/${booking._id}"
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
        <a href="${frontendUrl()}/events/${event._id}"
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

  async sendReviewRequest(organizer, vendorName, serviceName, link, reminder = false) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #9e3f68;">How was ${vendorName}?</h1>
        <p>Hi ${organizer.name},</p>
        <p>Your booking${serviceName ? ` for ${serviceName}` : ''} is complete. A quick rating takes less than a minute and helps
          other people choose, and helps good vendors get more bookings.</p>
        <a href="${link}"
           style="display: inline-block; background: #9e3f68; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
          Leave a review
        </a>
        <p style="color: #666;">Thank you for planning with Festivo.</p>
      </div>
    `;

    return this.sendEmail({
      to: organizer.email,
      subject: reminder ? `Reminder: how was ${vendorName}? - Festivo` : `How was ${vendorName}? - Festivo`,
      html
    });
  }

  // A guest without an account: their check-in code, and a private link
  // that brings their RSVP or ticket back on any device
  async sendGuestTicket({ to, name, event, checkInCode, paid, link }) {
    const escape = (text) => String(text || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const when = new Date(event.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1; font-size: 22px;">${paid ? 'Your ticket' : "You're on the list"}: ${escape(event.title)}</h1>
        <p>Hi ${escape(name)},</p>
        <p>${escape(when)}${event.time ? ` at ${escape(event.time)}` : ''}${event.locationName ? `, ${escape(event.locationName)}` : ''}.</p>
        <p style="font-size: 14px; color: #6b7280; margin-bottom: 4px;">Your check-in code</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; margin-top: 0;">${escape(checkInCode)}</p>
        <p>Show this code at the door.</p>
        <a href="${link}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          ${paid ? 'View or cancel your ticket' : 'View or change your RSVP'}
        </a>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">This link is private to you. Anyone with it can change or cancel your ${paid ? 'ticket' : 'RSVP'}, so don't forward it.</p>
      </div>
    `;
    return this.sendEmail({
      to,
      subject: `${paid ? 'Your ticket' : "You're on the list"}: ${event.title} - Festivo`,
      html,
      text: `${event.title}, ${when}\nYour check-in code: ${checkInCode}\n${link}`
    });
  }

  // An in-app notification, also sent by email
  async sendNotificationEmail(user, notification) {
    const escape = (text) => String(text || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const link = `${frontendUrl()}${notification.actionUrl || '/notifications'}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #6366f1; font-size: 22px;">${escape(notification.title)}</h1>
        <p>Hi ${escape(user.name)},</p>
        <p>${escape(notification.message)}</p>
        <a href="${link}"
           style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Open in Festivo
        </a>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">You get this email because of activity on your Festivo bookings or events.</p>
      </div>
    `;

    return this.sendEmail({
      to: user.email,
      subject: `${notification.title} - Festivo`,
      html,
      text: `${notification.title}\n\n${notification.message}\n\n${link}`
    });
  }
}

module.exports = new EmailService();
