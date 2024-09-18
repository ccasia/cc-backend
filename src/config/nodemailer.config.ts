import nodemailer from 'nodemailer';

// const user = process.env.SMTP_EMAIL || 'atiqah@cultcreative.asia';
// const pass = process.env.SMTP_PASSWORD || 'qszpxgxbqxkmbfqy';

const user = 'afiq@nexea.co';
const pass = 'mdpvhzojphixojxi';

const transport = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  secure: false,
  auth: {
    user: user,
    pass: pass,
  },
});

// const mailOptions = {
//   from: {
//     name: 'Atiqah',
//     address: user,
//   },
//   to: 'afiq@nexea.co',
//   subject: 'Testing',
//   text: 'Hello Afiq',
//   html: `<b>Hello Afiq</b>`,
// };

// const sendMail = async (transport: any, mailOptions: any) => {
//   try {
//     await transport.sendMail(mailOptions);
//     console.log(`Email has been sent.`);
//   } catch (error) {
//     console.log(error);
//   }
// };

// sendMail(transport, mailOptions);

export const AdminInvitaion = (email: string, confirmationCode: string) => {
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
          <a href="http://localhost/auth/jwt/adminForm?token=${confirmationCode}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Complete Registration</a>
          <p style="margin: 20px 0 0;">If you did not request this invitation, please ignore this email.</p>
        </div>
      </body>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const AdminInvite = (email: string, inviteCode: string) => {
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
          <a href="${process.env.BASE_EMAIL_URL}/admin/form/token=${inviteCode}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Complete Registration</a>
          <p style="margin: 20px 0 0;">If you did not request this invitation, please ignore this email.</p>
        </div>
      </body>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const creatorVerificationEmail = (email: string, confirmationToken: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: 'Your Cult Creative Sign in Link',
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email Template</title>
      <style>
        /* Reset styles */
        body, h1, p {
          margin: 0;
          padding: 0;
        }
    
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
          padding: 20px;
        }
    
        .container {
          max-width: 300px;
          margin: 0 auto;
          background-color: #ffffff;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
    
        h1 {
          color: #333333;
          margin-bottom: 20px;
        }
    
        p {
          color: #666666;
          margin-bottom: 20px;
          text-align:center;
          font-size: 13px;
        }
    
        .button {
          display: inline-block;
          padding: 10px 20px;
          background-color: #000000;
          text-decoration: none;
          border-radius: 5px;
          font-size: 13px;
          width: 80%;
        }
        
        .title{
            font-weight: bold;
            text-align: center;
        }
        
        .btn-container{
            text-align: center;
            margin: 20px 0;
            width: 100%;
        }

      </style>
    </head>
    <body>
      <div class="container">
        <h2 class="title">Cult Creative</h1>
        <hr />
        <p>To use Cult Creative Platform, click the verification button. This helps keep your account secure.</p>
        <div class="btn-container">
        <a href="${process.env.BASE_EMAIL_URL}/auth/verify/${confirmationToken}" class="button" style="color: white;">Verify my account</a>
        </div>        
        <p>You're receiving this email because you have an account in Cult Creative Platform. If you are not sure why you're receiving this, please contact us by replying to this email.</p>
      </div>
    </body>
    </html>
    
          `,
    })
    .catch((err) => {
      return err;
    });
};
