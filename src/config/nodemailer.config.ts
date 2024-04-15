import nodemailer from 'nodemailer';
// import dayjs from 'dayjs';
// import fs from 'fs';

const user = 'afiq@nexea.co';
// const pass = "nsxtsgpxyaxfjalr"; // Uses google's app specific password
const pass = 'bpnolahgcqzqxlmj';

const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  auth: {
    user: user,
    pass: pass,
  },
});

export const AdminInvitaion = ( email: string, confirmationCode: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: '[Cult Creative] Please complete your registration',
      html: `
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>verfiy your account </title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f4; margin: 0; padding: 0;">
        <div style="max-width: 600px; margin: auto; padding: 20px; background: #fff; border-radius: 5px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);">
          <h1 style="margin: 0 0 20px;">Welcome to our  System!</h1>
          <p style="margin: 0 0 20px;">You have been invited to join our system as an admin.</p>
          <p style="margin: 0 0 20px;">Please click on the following link to complete your registration:</p>
          <a href="http://localhost:3030/auth/jwt/adminForm?token=${confirmationCode}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Complete Registration</a>
          <p style="margin: 20px 0 0;">If you did not request this invitation, please ignore this email.</p>
        </div>
      </body>
          `,
    })
    .catch((err) => {
      return err;
    });
};
