"use client";

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/[\n\r]/g, '');
const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim().replace(/[\n\r]/g, '');

const isValidUrl = supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://');

// Only initialize Supabase if we are running locally to prevent production crashes while the feature is unfinished
const isLocalhost = typeof window !== 'undefined' ? window.location.hostname === 'localhost' : false;

export const supabase = (isLocalhost && isValidUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

console.log('Supabase init with URL:', supabase ? 'Set and Valid (Local)' : 'Disabled (Prod/Invalid)');
