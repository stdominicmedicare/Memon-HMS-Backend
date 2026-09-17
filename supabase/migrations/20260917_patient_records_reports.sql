-- Patient Records: MRN, demographics, merge support, search indexes.
-- Apply on existing Supabase projects (SQL Editor or supabase db push).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mrn text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_mrn_uidx
  ON public.profiles (mrn)
  WHERE mrn IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_full_name_idx
  ON public.profiles (full_name);

CREATE INDEX IF NOT EXISTS profiles_phone_idx
  ON public.profiles (phone);

CREATE INDEX IF NOT EXISTS profiles_dob_idx
  ON public.profiles (date_of_birth);

CREATE INDEX IF NOT EXISTS medical_records_patient_idx
  ON public.medical_records (patient_id);

CREATE INDEX IF NOT EXISTS prescriptions_patient_idx
  ON public.prescriptions (patient_id);

CREATE SEQUENCE IF NOT EXISTS public.mrn_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.next_mrn()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'MRN-' || to_char(timezone('utc', now()), 'YYYY') || '-' ||
    lpad(nextval('public.mrn_seq')::text, 6, '0');
END;
$$;

-- Backfill MRNs for existing Patient profiles
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles
    WHERE role = 'Patient' AND mrn IS NULL
    ORDER BY created_at NULLS LAST, id
  LOOP
    UPDATE public.profiles SET mrn = public.next_mrn() WHERE id = r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.assign_patient_mrn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'Patient' AND (NEW.mrn IS NULL OR NEW.mrn = '') THEN
    NEW.mrn := public.next_mrn();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_mrn ON public.profiles;
CREATE TRIGGER profiles_assign_mrn
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_patient_mrn();

-- Enrich signup trigger: staff roles, phone, DOB, MRN for patients
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_role text;
  resolved_role public.app_role;
  meta_phone text;
  meta_dob date;
BEGIN
  meta_role := COALESCE(NEW.raw_user_meta_data->>'role', '');
  IF meta_role = '' THEN
    resolved_role := 'Patient';
  ELSIF meta_role IN (
    'GeneralUser','Patient','Doctor','Admin','Ambulance','ICU',
    'Pharmacy','BloodBank','Blood Bank','Volunteer',
    'Nurse','Receptionist','RecordsOfficer'
  ) THEN
    resolved_role := meta_role::public.app_role;
  ELSE
    resolved_role := 'Patient';
  END IF;

  meta_phone := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'phone', '')), '');
  BEGIN
    IF COALESCE(NEW.raw_user_meta_data->>'date_of_birth', '') <> '' THEN
      meta_dob := (NEW.raw_user_meta_data->>'date_of_birth')::date;
    END IF;
  EXCEPTION WHEN others THEN
    meta_dob := NULL;
  END;

  INSERT INTO public.profiles (id, email, full_name, phone, date_of_birth, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    meta_phone,
    meta_dob,
    resolved_role,
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

GRANT USAGE, SELECT ON SEQUENCE public.mrn_seq TO service_role;
