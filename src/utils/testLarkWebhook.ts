/**
 * Test script for Lark webhook integration
 * 
 * Usage:
 * 1. Make sure LARK_FEEDBACK_WEBHOOK_URL is set in your .env file
 * 2. Run: npx ts-node src/utils/testLarkWebhook.ts
 */

import { sendFeedbackToLark, sendSimpleFeedbackToLark } from './larkNotification';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testLarkWebhook() {
  console.log('🧪 Testing Lark Webhook Integration...\n');

  // Check if webhook URL is configured
  if (!process.env.LARK_FEEDBACK_WEBHOOK_URL) {
    console.error('❌ Error: LARK_FEEDBACK_WEBHOOK_URL not found in .env file');
    console.log('\nPlease add the following to your .env file:');
    console.log('LARK_FEEDBACK_WEBHOOK_URL="your-webhook-url-here"\n');
    process.exit(1);
  }

  console.log('✅ Webhook URL found:', process.env.LARK_FEEDBACK_WEBHOOK_URL.substring(0, 50) + '...\n');

  // Test 1: Rich card format (default)
  console.log('📤 Test 1: Sending rich card format...');
  const testData1 = {
    userName: 'Test User',
    userEmail: 'test@example.com',
    userType: 'CREATOR' as const,
    rating: 5,
    feedback: 'This is a test feedback message. The integration is working perfectly! 🎉',
    deviceType: 'desktop',
    os: 'macOS 14.0',
    browser: 'Chrome 120.0',
    timestamp: new Date().toISOString(),
  };

  const result1 = await sendFeedbackToLark(testData1);
  if (result1) {
    console.log('✅ Test 1 passed: Rich card sent successfully\n');
  } else {
    console.log('❌ Test 1 failed: Could not send rich card\n');
  }

  // Wait a bit before sending the second test
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Simple text format
  console.log('📤 Test 2: Sending simple text format...');
  const testData2 = {
    userName: 'Jane Smith',
    userEmail: 'jane@example.com',
    userType: 'CLIENT' as const,
    rating: 3,
    feedback: 'This is a simple text format test.',
    deviceType: 'mobile',
    os: 'iOS 17.0',
    browser: 'Safari 17.0',
    timestamp: new Date().toISOString(),
  };

  const result2 = await sendSimpleFeedbackToLark(testData2);
  if (result2) {
    console.log('✅ Test 2 passed: Simple text sent successfully\n');
  } else {
    console.log('❌ Test 2 failed: Could not send simple text\n');
  }

  // Wait a bit before sending the third test
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 3: Low rating (should be red)
  console.log('📤 Test 3: Sending low rating feedback...');
  const testData3 = {
    userName: 'Unhappy User',
    userEmail: 'unhappy@example.com',
    userType: 'CREATOR' as const,
    rating: 1,
    feedback: 'Very disappointed with the experience. Needs improvement!',
    deviceType: 'tablet',
    os: 'Android 13.0',
    browser: 'Chrome Mobile 120.0',
    timestamp: new Date().toISOString(),
  };

  const result3 = await sendFeedbackToLark(testData3);
  if (result3) {
    console.log('✅ Test 3 passed: Low rating feedback sent successfully\n');
  } else {
    console.log('❌ Test 3 failed: Could not send low rating feedback\n');
  }

  // Summary
  console.log('=' .repeat(50));
  console.log('📊 Test Summary:');
  console.log(`Rich Card: ${result1 ? '✅ Success' : '❌ Failed'}`);
  console.log(`Simple Text: ${result2 ? '✅ Success' : '❌ Failed'}`);
  console.log(`Low Rating: ${result3 ? '✅ Success' : '❌ Failed'}`);
  console.log('=' .repeat(50));
  console.log('\nCheck your Lark channel for the test messages!');
}

// Run the test
testLarkWebhook()
  .then(() => {
    console.log('\n✨ Test completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test failed with error:', error);
    process.exit(1);
  });
