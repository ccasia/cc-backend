import axios from 'axios';

interface LarkCardElement {
  tag: string;
  text?: {
    content: string;
    tag: string;
  };
  fields?: Array<{
    is_short: boolean;
    text: {
      content: string;
      tag: string;
    };
  }>;
}

interface FeedbackData {
  userName?: string;
  userEmail?: string;
  userType: 'CLIENT' | 'CREATOR';
  rating: number;
  feedback?: string;
  deviceType?: string;
  os?: string;
  browser?: string;
  timestamp: string;
}

/**
 * Send a notification to Lark (Feishu) webhook when new feedback is received
 */
export const sendFeedbackToLark = async (feedbackData: FeedbackData): Promise<boolean> => {
  try {
    const webhookUrl = process.env.LARK_FEEDBACK_WEBHOOK_URL;

    if (!webhookUrl) {
      console.warn('⚠️  LARK_FEEDBACK_WEBHOOK_URL not configured. Skipping Lark notification.');
      return false;
    }

    // Create star rating visual
    const stars = '⭐'.repeat(feedbackData.rating) + '☆'.repeat(5 - feedbackData.rating);
    
    // Determine sentiment color
    const ratingColor = feedbackData.rating >= 4 ? 'green' : feedbackData.rating === 3 ? 'orange' : 'red';
    
    // Build device info string
    const deviceInfo = [
      feedbackData.deviceType,
      feedbackData.os,
      feedbackData.browser,
    ].filter(Boolean).join(' • ');

    // Build card elements
    const cardElements: LarkCardElement[] = [
      {
        tag: 'div',
        text: {
          content: `**New ${feedbackData.userType === 'CREATOR' ? 'Creator' : 'Client'} Feedback Received**`,
          tag: 'lark_md',
        },
      },
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: {
              content: `**User:**\n${feedbackData.userName || 'Anonymous'}`,
              tag: 'lark_md',
            },
          },
          {
            is_short: true,
            text: {
              content: `**Email:**\n${feedbackData.userEmail || 'N/A'}`,
              tag: 'lark_md',
            },
          },
          {
            is_short: true,
            text: {
              content: `**User Type:**\n${feedbackData.userType}`,
              tag: 'lark_md',
            },
          },
          {
            is_short: true,
            text: {
              content: `**Rating:**\n${stars} (${feedbackData.rating}/5)`,
              tag: 'lark_md',
            },
          },
        ],
      },
    ];

    // Add feedback text if provided
    if (feedbackData.feedback) {
      cardElements.push(
        {
          tag: 'hr',
        },
        {
          tag: 'div',
          text: {
            content: `**Feedback:**\n${feedbackData.feedback}`,
            tag: 'lark_md',
          },
        }
      );
    }

    // Add device info if available
    if (deviceInfo) {
      cardElements.push(
        {
          tag: 'hr',
        },
        {
          tag: 'div',
          text: {
            content: `**Device Info:**\n${deviceInfo}`,
            tag: 'lark_md',
          },
        }
      );
    }

    // Add timestamp
    cardElements.push(
      {
        tag: 'hr',
      },
      {
        tag: 'div',
        text: {
          content: `*Received at: ${feedbackData.timestamp}*`,
          tag: 'lark_md',
        },
      }
    );

    // Prepare the Lark message payload
    const payload = {
      msg_type: 'interactive',
      card: {
        config: {
          wide_screen_mode: true,
        },
        header: {
          title: {
            content: `📝 New Feedback - ${feedbackData.rating}/5 Stars`,
            tag: 'plain_text',
          },
          template: ratingColor,
        },
        elements: cardElements,
      },
    };

    // Send to Lark webhook
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    if (response.data.StatusCode === 0 || response.status === 200) {
      console.log('✅ Feedback sent to Lark successfully');
      return true;
    } else {
      console.error('❌ Failed to send feedback to Lark:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending feedback to Lark:', error);
    return false;
  }
};

/**
 * Alternative simple text message format
 */
export const sendSimpleFeedbackToLark = async (feedbackData: FeedbackData): Promise<boolean> => {
  try {
    const webhookUrl = process.env.LARK_FEEDBACK_WEBHOOK_URL;

    if (!webhookUrl) {
      console.warn('⚠️  LARK_FEEDBACK_WEBHOOK_URL not configured. Skipping Lark notification.');
      return false;
    }

    const stars = '⭐'.repeat(feedbackData.rating);
    const emoji = feedbackData.userType === 'CREATOR' ? '🎨' : '👔';
    
    let message = `${emoji} **New ${feedbackData.userType} Feedback**\n\n`;
    message += `**User:** ${feedbackData.userName || 'Anonymous'}\n`;
    message += `**Email:** ${feedbackData.userEmail || 'N/A'}\n`;
    message += `**Rating:** ${stars} ${feedbackData.rating}/5\n\n`;
    
    if (feedbackData.feedback) {
      message += `**Feedback:**\n${feedbackData.feedback}\n\n`;
    }
    
    message += `*${feedbackData.timestamp}*`;

    const payload = {
      msg_type: 'text',
      content: {
        text: message,
      },
    };

    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });

    return response.data.StatusCode === 0 || response.status === 200;
  } catch (error) {
    console.error('❌ Error sending simple feedback to Lark:', error);
    return false;
  }
};
