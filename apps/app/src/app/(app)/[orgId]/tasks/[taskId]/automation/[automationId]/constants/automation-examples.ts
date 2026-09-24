import { logoUrl } from '@trycompai/utils';

export interface AutomationExample {
  title: string;
  prompt: string;
  url: string;
}

export const AUTOMATION_EXAMPLES: AutomationExample[] = [
  {
    title: 'Check if I have dependabot enabled in my GitHub repository',
    prompt: 'Check if I have dependabot enabled in my GitHub repository',
    url: logoUrl('github.com'),
  },
  {
    title: 'Check if I have branch protection enabled for the main branch in my GitHub repository',
    prompt: 'Check if I have branch protection enabled for the main branch in my GitHub repository',
    url: logoUrl('github.com'),
  },
  {
    title: 'Check if my website has a privacy policy',
    prompt: 'Check if my website has a privacy policy',
    url: logoUrl('trycomp.ai'),
  },
  {
    title: 'Give me a list of failed deployments in my Vercel project',
    prompt: 'Give me a list of failed deployments in my Vercel project',
    url: logoUrl('vercel.com'),
  },
  {
    title: 'Check that DDoS protection is enabled for my Cloudflare project',
    prompt: 'Check that DDoS protection is enabled for my Cloudflare project',
    url: logoUrl('cloudflare.com'),
  },
];
