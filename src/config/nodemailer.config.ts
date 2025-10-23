import nodemailer from 'nodemailer';

const user = process.env.SMTP_EMAIL || 'support@cultcreative.asia';
const pass = process.env.SMTP_PASSWORD || 'pdljdgzcyjpjukqn';

const transport = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  secure: false,
  auth: {
    user: user,
    pass: pass,
  },
  //   tls: {
  //     rejectUnauthorized: false,
  //   },
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
//     //console.log(`Email has been sent.`);
//   } catch (error) {
//     //console.log(error);
//   }
// };

// sendMail(transport, mailOptions);

// Generic email sending function
export const sendEmail = async (mailOptions: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) => {
  try {
    await transport.sendMail({
      from: mailOptions.from || user,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
    });
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

export const ClientInvitation = (email: string, inviteToken: string, companyName: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: '[Cult Creative] Welcome to Your Client Portal',
      html: `
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Client Portal Invitation</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f4; margin: 0; padding: 0;">
          <div style="max-width: 600px; margin: auto; padding: 20px; background: #fff; border-radius: 5px; box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);">
            <h1 style="margin: 0 0 20px;">Welcome to Cult Creative Client Portal!</h1>
            <p style="margin: 0 0 20px;">Hello,</p>
            <p style="margin: 0 0 20px;">You have been invited to access the client portal for ${companyName}.</p>
            <p style="margin: 0 0 20px;">Please click on the following link to set up your password and access your account:</p>
            <a href="${process.env.BASE_EMAIL_URL}/auth/jwt/client/setup-password?token=${inviteToken}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Set Up Your Account</a>
            <p style="margin: 20px 0 0;">If you did not expect this invitation, please contact support.</p>
          </div>
        </body>
      `,
    })
    .catch((err) => {
      return err;
    });
};

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
          <h1 style="margin: 0 0 20px;">Welcome to Cult Creative Platform!</h1>
          <p style="margin: 0 0 20px;">You have been invited to join our system as an admin.</p>
          <p style="margin: 0 0 20px;">Please click on the following link to complete your registration:</p>
          <a href="${process.env.BASE_EMAIL_URL}/auth/jwt/adminForm?token=${confirmationCode}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: #fff; text-decoration: none; border-radius: 5px;">Complete Registration</a>
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
      <a href="${process.env.BASE_EMAIL_URL}/auth/verify/${confirmationToken}" class="button" style="color: white;background-color: black;">Verify my account</a>
      </div>        
      <p>You're receiving this email because you have an account in Cult Creative Platform. If you are not sure why you're receiving this, please contact us by replying to this email.</p>
      <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
          <tr style="text-align: center;">
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                  </a>
              </td>
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                  </a>
              </td>
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                  </a>
              </td>
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                  </a>
              </td>
          </tr>
      </table>

      <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
          <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
              <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
          </a>
          <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
          <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
      </div>
    </div>
  </body>
  </html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const clientVerificationEmail = (email: string, confirmationToken: string) => {
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
      <p>Welcome to Cult Creative! Click the verification button to activate your client account and start discovering amazing creators for your brand campaigns.</p>
      <div class="btn-container">
      <a href="${process.env.BASE_EMAIL_URL}/auth/verify/${confirmationToken}" class="button" style="color: white;background-color: black;">Verify my account</a>
      </div>        
      <p>You're receiving this email because you've registered as a client on Cult Creative Platform. If you are not sure why you're receiving this, please contact us by replying to this email.</p>
      <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
          <tr style="text-align: center;">
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                  </a>
              </td>
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                  </a>
              </td>
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                  </a>
              </td>
              <td align="center" style="padding: 0 10px;">
                  <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                      <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                  </a>
              </td>
          </tr>
      </table>

      <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
          <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
              <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
          </a>
          <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
          <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
      </div>
    </div>
  </body>
  </html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

// Creator Notifications

export const shortlisted = (
  email: string,
  campaignName: string,
  creatorName: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `🎉 You’ve Been Shortlisted for ${campaignName}!`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🎉 You’ve Been Shortlisted for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">🎉 You’ve Been Shortlisted for ${campaignName}</h2>
        <img src=${campaignImage ?? 'https://drive.google.com/uc?id=1lpDBTeil5asnkSW7B7T7_77EFpTQJcva'} alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${creatorName}, Congrats! You've been shortlisted for <a href="#" style="color: #0874dc;">${campaignName}</a>. Stay tuned for updates!</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      console.log(err);
      return err;
    });
};

export const firstDraftDue = (
  email: string,
  campaignName: string,
  creatorName: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `First Draft for ${campaignName} Due Soon`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>First Draft for ${campaignName} Due Soon</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">We Can't Wait To See Your Masterpiece 🎨</h2>
        <img src="${campaignImage ?? 'https://drive.google.com/uc?id=1lpDBTeil5asnkSW7B7T7_77EFpTQJcva'}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hey ${creatorName}, Your first draft is due soon—don't forget to submit it on the platform!</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const feedbackOnDraft = (email: string, campaignName: string, creatorName: string, campaignId: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Feedback on Your ${campaignName} Draft`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Feedback on Your ${campaignName} Draft</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Feedback on Your ${campaignName} Draft</h2>
        <img src="https://drive.google.com/uc?id=1lpDBTeil5asnkSW7B7T7_77EFpTQJcva" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${creatorName}, We’ve provided feedback on your draft.</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const finalDraftDue = (
  email: string,
  campaignName: string,
  creatorName: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Final Draft for ${campaignName} Due Soon`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Final Draft for ${campaignName} Due Soon</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Final Draft for ${campaignName} Due Soon</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${creatorName}, A reminder that your final draft is due soon.</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const approvalOfDraft = (
  email: string,
  campaignName: string,
  creatorName: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Your Draft for ${campaignName} Is Approved!`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Good news—they loved your draft 🤩</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
      <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Good news—they loved your draft 🤩</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hey ${creatorName},</p>
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Your draft has been approved. Keep up the good work!</p>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const postingSchedule = (
  email: string,
  campaignName: string,
  creatorName: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `New Posting Schedule for ${campaignName}`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Posting Schedule for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Are You Ready To Post? 👀</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hey ${creatorName}, Your posting schedule is now available. Check it out on the platform!</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const tracking = (
  email: string,
  campaignName: string,
  creatorName: string,
  trackingNumber: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Logistics Submitted for ${campaignName}`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Logistics Submitted for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Logistics Submitted for ${campaignName}</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${creatorName}, Your logistics have been submitted, tracking number ${trackingNumber}.</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const deliveryConfirmation = (
  email: string,
  campaignName: string,
  creatorName: string,
  campaignId: string,
  campaignImage: string,
) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Logistics Delivered for ${campaignName}`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Logistics Delivered for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Logistics Delivered for ${campaignName}</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${creatorName}, The logistics have been delivered.</p>
        <a href="${process.env.BASE_EMAIL_URL}/dashboard/campaign/VUquQR/HJUboKDBwJi71KQ==/manage/detail/${campaignId}" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Campaign Details</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const creatorInvoice = (email: string, campaignName: string, creatorName: string, campaignImage: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Your Invoice for ${campaignName} Is Ready!`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invoice Generated for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">You'll Be Getting Paid Soon 💰</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hey ${creatorName},</p>
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Get excited, an invoice has been generated for your campaign!</p>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const rejectInvoiceEmail = async (email: string, campaignName: string, reason: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `⚠️ Whoops, Invoice Rejected!`,
      html: `
        <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>⚠️ Whoops, Invoice Rejected!</title>
        </head>
        
        <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
        <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
        <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
              <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
        </div>
          <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">⚠️ Whoops, Invoice Rejected!</h2>
          <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Your invoice for ${campaignName} has been rejected due to ${reason}. Please amend details Payment Details to get paid! </p>
          <a href="${process.env.BASE_EMAIL_URL}/dashboard/user/profile/payment" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">Edit Payment Details</a>
          <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
          <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>
  
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
              <tr>
                  <td align="center" style="padding: 0 10px;">
                      <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                          <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                      </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                      <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                          <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                      </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                      <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                          <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                      </a>
                  </td>
                  <td align="center" style="padding: 0 10px;">
                      <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                          <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                      </a>
                  </td>
              </tr>
          </table>
  
          <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
              <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                  <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
              </a>
              <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
              <p>If you have any questions, please email us at <a href="mailto:hello@cultcreative.asia" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">hello@cultcreative.asia</a> or send us a text on <a href="https://api.whatsapp.com/send/?phone=60162678757&text&type=phone_number&app_absent=0" style="color: #0874dc; font-weight: bold; font-size: 12px; text-decoration: none;">Whatsapp at +60162678757</a>.</p>
          </div>
      </div>
  
  </body>
  </html>
            `,
    })
    .catch((err) => {
      console.log(err);
      return err;
    });
};

// Admin Notifications

export const csmAdminInvoice = (email: string, campaignName: string, adminName: string, campaignImage: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `Invoice Generated for ${campaignName}`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Invoice Generated for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">Invoice Generated for ${campaignName}</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${adminName}, An invoice has been generated.</p>
        <a href="#" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Invoice on Dashboard</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you encounter any issues, please access the <a href="#">Dashboard</a> and navigate to the Campaign section for detailed information.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const financeAdminInvoice = (email: string, campaignName: string, adminName: string, campaignImage: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: `New Invoice Generated for ${campaignName}`,
      html: `
      <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Invoice Generated for ${campaignName}</title>
      </head>
      
      <body style="margin: 0; padding: 20px; background-color: #f5f5f7; font-family: Arial, sans-serif;">
      <div class="container" style="max-width: 420px; margin: 0 auto; background-color: #ffffff; padding: 40px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); border: 0.1px dashed #777777; border-radius: 10px;">
      <div class="header" style="display: flex; align-items: center; margin-bottom: 30px;">
            <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Company Logo" class="logo" style="max-width: 150px; margin-right: 30px;">
      </div>
        <h2 style="color: #686464; font-size: 24px; font-weight: bold; margin-top: 40px; margin-bottom: 40px;">New Invoice Generated for ${campaignName}</h2>
        <img src="${campaignImage}" alt="Campaign Image" class="campaign-image" style="display: block; width: 100%; max-height: 300px; object-fit: cover; margin: 30px 0;">
        <p style="color: #686464; text-align: left; font-size: 14px; line-height: 1.6; font-family: 'Roboto', sans-serif;">Hi ${adminName}, A new invoice has been generated.</p>
        <a href="#" class="button" style="display: inline-block; padding: 15px 30px; background-color: #0874dc; text-decoration: none; border-radius: 6px; font-size: 16px; color: #ffffff; text-align: center; margin: 30px auto; display: block; font-weight: bold; transition: background-color 0.3s;">View Invoice on Dashboard</a>
        <div class="separator" style="border-top: 1px solid #ddd; margin: 35px 0;"></div>
        <p id="slogan" style="color: #686464; font-size: 12px; padding-top: 0px; display: block; text-align: center; font-weight: bold; margin-bottom: 20px;">Where Brands and Creatives Co-create</p>

        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin-bottom: 20px;">
            <tr>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.instagram.com/cultcreativeasia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1WTjbjcjJ7JW_gC5rL426nLs_EmZi98Qp" alt="Instagram" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.youtube.com/@cultcreativeapp" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=18P3sGw7JTbeHIZVYA1XB_psp9bZvngHr" alt="YouTube" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.facebook.com/CultCreativeAsia/" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=15qY40yjw3Jeh5BoKUkjj6730RsolyK9E" alt="Facebook" style="width: 25px; height: auto;">
                    </a>
                </td>
                <td align="center" style="padding: 0 10px;">
                    <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                        <img src="https://drive.google.com/uc?id=1yt8fs0K1om0wsHD8LWFFysovkeIMgmg2" alt="Website" style="width: 25px; height: auto;">
                    </a>
                </td>
            </tr>
        </table>

        <div class="footer" style="font-size: 12px; color: #686464; text-align: left; margin-top: 40px; padding: 0 20px; position: relative;">
            <a href="https://www.cultcreative.asia" target="_blank" style="text-decoration: none;">
                <img src="https://drive.google.com/uc?id=13ICuo00aWLG8XUikZ_6vSP7ej_CFQdjQ" alt="Footer Logo" style="max-width: 60px; display: block;">
            </a>
            <p id="company-reg" style="color: #686464; font-size: 11px; padding-top: 0px;">202001018157 (1374477-W) <br> 2024 &copy; Cult Creative. All Rights Reserved.</p>
            <p>If you encounter any issues, please access the <a href="#">Dashboard</a> and navigate to the Campaign section for detailed information.</p>
        </div>
    </div>

</body>
</html>
          `,
    })
    .catch((err) => {
      return err;
    });
};

export const forgetPasswordEmail = (email: string, token: string, name?: string) => {
  transport
    .sendMail({
      from: user,
      to: email,
      subject: '[Cult Creative] Reset your password',
      html: `
       <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            color: #333;
        }
        .container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
            background-color: #fff;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        h2 {
            color: #007BFF;
        }
        p {
            font-size: 16px;
        }
        a.button {
            display: inline-block;
            padding: 10px 20px;
            margin-top: 20px;
            background-color: #007BFF;
            color: #fff;
            text-decoration: none;
            border-radius: 5px;
        }
        a.button:hover {
            background-color: #0056b3;
        }
        .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #888;
        }
    </style>
</head>
<body>
    <div class="container">
        <h2>Password Reset Request</h2>
        <p>Hello ${name},</p>
        <p>We received a request to reset the password for your account at <strong>Cult Creative Platform</strong>. If you did not request a password reset, please ignore this email.</p>
        <p>To reset your password, click the button below:</p>
        <a href="${process.env.BASE_EMAIL_URL}/auth/jwt/new-password?token=${token}" class="button">Reset Password</a>
        <p>Or copy and paste this URL into your browser:</p>
        <p><a href="${process.env.BASE_EMAIL_URL}/auth/jwt/new-password?token=${token}">${process.env.BASE_EMAIL_URL}/auth/jwt/new-password?token=${token}</a></p>
        <p>This link will expire in 15 minutes for security reasons.</p>
        <p>If you continue to have trouble, please contact our support team.</p>
        <p>Thank you,<br>The Cult Creative Team</p>
        <div class="footer">
            <p>&copy; Cult Creative Platform. All rights reserved.</p>
        </div>
    </div>
</body>
          `,
    })
    .catch((err) => {
      return err;
    });
};