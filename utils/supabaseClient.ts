"use client";

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const isValidUrl = supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://');

export const supabase = (isValidUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

console.log('Supabase init with URL:', isValidUrl ? 'Set and Valid' : 'Missing or Invalid');
