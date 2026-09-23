import { expect, test } from '@playwright/test';

const ANSWERS = [
  "I'm Nina, born 1993-03-14, woman",
  'Men, 28-42, Berlin, 60 km',
  'Long-term, no kids, maybe children, within a year',
  'Smoking never, alcohol socially, exercise often, early bird, a dog, relocate maybe',
  '5 3 3',
  'Direct and calm. 75 65 55 80 25',
  'hiking, cooking, books, jazz. Weekends are for long hikes and slow dinners with friends.',
  'no smokers',
];

test('new user onboards through the built-in agent and gets an active profile', async ({ page }) => {
  const email = `ui-${Date.now()}@example.com`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-9');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Consents: the three required boxes, sensitive data left unchecked.
  await expect(page).toHaveURL(/onboarding\/consent/);
  await page.getByText('I accept the Terms of Service.').click();
  await page.getByText('I have read the Privacy Policy.').click();
  await page.getByText('I agree that AI agents may process my profile').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // 18+ check through the mock vendor.
  await expect(page).toHaveURL(/onboarding\/verify/);
  await page.getByRole('button', { name: 'Start verification' }).click();
  await expect(page).toHaveURL(/verify\/mock/);
  await page.locator('input[type=date]').fill('1993-03-14');
  await page.getByRole('button', { name: 'Submit' }).click();

  // Connect: MCP URL is shown; use the built-in agent.
  await expect(page).toHaveURL(/onboarding\/connect/);
  await expect(page.locator('input[readonly]').first()).toHaveValue(/\/mcp$/);
  await page.screenshot({ path: 'e2e/screens/connect.png', fullPage: true });
  await page.getByRole('link', { name: 'Start the interview' }).click();

  await expect(page.getByText(/Let's start with the basics/)).toBeVisible();
  for (const answer of ANSWERS) {
    await page.getByPlaceholder('Type your answer…').fill(answer);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByPlaceholder('Type your answer…').or(page.getByText('Your draft is ready for review.'))).toBeVisible();
  }
  await expect(page.getByText('Your draft is ready for review.')).toBeVisible();
  await page.screenshot({ path: 'e2e/screens/interview.png', fullPage: true });
  await page.getByRole('link', { name: 'Review profile' }).click();

  // Nothing applied until the human approves the draft.
  await expect(page.getByText('Changes proposed by your AI')).toBeVisible();
  await expect(page.getByText('INCOMPLETE')).toBeVisible();
  await page.screenshot({ path: 'e2e/screens/review.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('ACTIVE')).toBeVisible();
  await expect(page.getByText('Changes proposed by your AI')).toHaveCount(0);

  await page.getByRole('link', { name: 'Matches', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today’s matches' })).toBeVisible();
});

test('demo user sees matches, the agent journal and can like with a disclosure choice', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('demo@agentmatch.local');
  await page.getByLabel('Password').fill('demo-password-1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Today’s matches' })).toBeVisible();
  const likeButtons = page.getByRole('button', { name: '♥ Like' });
  if (await likeButtons.count()) {
    await expect(page.getByText('Why this match').first()).toBeVisible();
    await page.screenshot({ path: 'e2e/screens/matches.png', fullPage: true });
    await likeButtons.first().click();
    await expect(page.getByText('What do you want to share if the like is mutual?')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm like' }).click();
    await expect(page.getByText(/You liked this match|It’s mutual!/).first()).toBeVisible();
  }
  await page.getByRole('link', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What your agent did' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screens/agent.png', fullPage: true });
});
