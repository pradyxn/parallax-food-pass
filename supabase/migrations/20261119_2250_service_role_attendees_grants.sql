-- Allow the server-only Supabase service role to perform the app's attendee operations.
-- No privileges are granted to anon or authenticated roles; RLS remains enabled.
grant select, insert, update on table public.attendees to service_role;
