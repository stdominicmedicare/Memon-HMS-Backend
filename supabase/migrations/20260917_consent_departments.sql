-- Patient data-storage consent + configurable departments catalog.
-- Apply after 20260917_patient_records_reports.sql / audit / RLS migrations.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS data_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_consent_method text;

COMMENT ON COLUMN public.profiles.data_consent IS
  'Patient (or registering staff) acknowledged consent to store health/personal data';
COMMENT ON COLUMN public.profiles.data_consent_at IS
  'When data-storage consent was recorded';
COMMENT ON COLUMN public.profiles.data_consent_method IS
  'How consent was captured: self_signup | staff_registration | legacy_backfill';

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_name_uidx UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS departments_is_active_idx
  ON public.departments (is_active);

INSERT INTO public.departments (name, code)
VALUES
  ('Internal Medicine', 'IM'),
  ('Cardiology', 'CARD'),
  ('Emergency', 'ER'),
  ('Pediatrics', 'PED'),
  ('Obstetrics & Gynecology', 'OBGYN'),
  ('Surgery', 'SURG'),
  ('Orthopedics', 'ORTHO'),
  ('Radiology', 'RAD'),
  ('Laboratory', 'LAB'),
  ('ICU', 'ICU'),
  ('Pharmacy', 'PHARM'),
  ('Blood Bank', 'BB'),
  ('Outpatient / OPD', 'OPD'),
  ('Front Desk / Reception', 'FD')
ON CONFLICT (name) DO NOTHING;

-- Seed departments already used on doctor profiles
INSERT INTO public.departments (name)
SELECT DISTINCT trim(department)
FROM public.profiles
WHERE department IS NOT NULL AND trim(department) <> ''
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_authenticated_all ON public.departments;
REVOKE ALL ON TABLE public.departments FROM anon, authenticated;
GRANT ALL ON TABLE public.departments TO service_role;

-- Enrich signup trigger: phone, DOB, consent for patients
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
  meta_consent boolean := false;
  meta_consent_at timestamptz := NULL;
  meta_consent_method text := NULL;
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

  IF lower(COALESCE(NEW.raw_user_meta_data->>'data_consent', '')) IN ('true', '1', 'yes') THEN
    meta_consent := true;
    meta_consent_at := now();
    meta_consent_method := COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data->>'data_consent_method'), ''),
      'self_signup'
    );
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name, phone, date_of_birth, role, is_active,
    data_consent, data_consent_at, data_consent_method
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    meta_phone,
    meta_dob,
    resolved_role,
    true,
    meta_consent,
    meta_consent_at,
    meta_consent_method
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
