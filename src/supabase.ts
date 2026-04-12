import { createClient } from '@supabase/supabase-js';
import { UserProfile, WorkoutSession, Routine } from './types';

const SUPABASE_URL = 'https://sdqgrsishnvdvpyigvxu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcWdyc2lzaG52ZHZweWlndnh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMTE2NzcsImV4cCI6MjA5MTU4NzY3N30.cHNnuLnMf67RWg-XXTBxiGdO2jcQSAWzAI5W8AcLBHg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── PROFILES ──────────────────────────────────────────────────────────────

export async function fetchProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at');
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    username: row.username,
    password: row.password,
    avatarUrl: row.avatar_url ?? undefined,
  }));
}

export async function createProfile(p: Omit<UserProfile, 'id'>): Promise<UserProfile> {
  const { data, error } = await supabase.from('profiles').insert({
    name: p.name,
    username: p.username,
    password: p.password,
    avatar_url: p.avatarUrl ?? null,
  }).select().single();
  if (error) throw error;
  return { id: data.id, name: data.name, username: data.username, password: data.password, avatarUrl: data.avatar_url ?? undefined };
}

export async function updateProfile(p: UserProfile): Promise<void> {
  const { error } = await supabase.from('profiles').update({
    name: p.name,
    username: p.username,
    password: p.password,
    avatar_url: p.avatarUrl ?? null,
  }).eq('id', p.id);
  if (error) throw error;
}

export async function deleteProfile(id: string): Promise<void> {
  const { error } = await supabase.from('profiles').delete().eq('id', id);
  if (error) throw error;
}

// ─── ROUTINES ──────────────────────────────────────────────────────────────

export async function fetchRoutine(userId: string): Promise<Routine | null> {
  const { data, error } = await supabase.from('routines').select('routine_data').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? (data.routine_data as Routine) : null;
}

export async function upsertRoutine(userId: string, routine: Routine): Promise<void> {
  const { error } = await supabase.from('routines').upsert(
    { user_id: userId, routine_data: routine, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

export async function deleteRoutine(userId: string): Promise<void> {
  const { error } = await supabase.from('routines').delete().eq('user_id', userId);
  if (error) throw error;
}

// ─── SESSIONS ──────────────────────────────────────────────────────────────

export async function fetchSessions(userId: string): Promise<WorkoutSession[]> {
  const { data, error } = await supabase.from('sessions')
    .select('*').eq('user_id', userId).order('date', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    dayName: row.day_name,
    userName: row.user_id,
    date: row.date,
    note: row.note ?? undefined,
    exercises: row.exercises as WorkoutSession['exercises'],
  }));
}

export async function insertSession(userId: string, session: WorkoutSession): Promise<void> {
  const { error } = await supabase.from('sessions').insert({
    id: session.id,
    user_id: userId,
    day_name: session.dayName,
    date: session.date,
    note: session.note ?? null,
    exercises: session.exercises,
  });
  if (error) throw error;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ─── WEIGHTS ───────────────────────────────────────────────────────────────

export async function fetchWeights(userId: string): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.from('weights').select('exercise_id, sets').eq('user_id', userId);
  if (error) throw error;
  const result: Record<string, string[]> = {};
  for (const row of data || []) result[row.exercise_id] = row.sets as string[];
  return result;
}

export async function upsertWeight(userId: string, exerciseId: string, sets: string[]): Promise<void> {
  const { error } = await supabase.from('weights').upsert(
    { user_id: userId, exercise_id: exerciseId, sets, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,exercise_id' }
  );
  if (error) throw error;
}
