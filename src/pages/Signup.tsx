import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

type Step = 'signup' | 'otp';

const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: '+93', label: 'Afghanistan (AF)' },
  { code: '+355', label: 'Albania (AL)' },
  { code: '+213', label: 'Algeria (DZ)' },
  { code: '+1684', label: 'American Samoa (AS)' },
  { code: '+376', label: 'Andorra (AD)' },
  { code: '+244', label: 'Angola (AO)' },
  { code: '+1264', label: 'Anguilla (AI)' },
  { code: '+1268', label: 'Antigua and Barbuda (AG)' },
  { code: '+54', label: 'Argentina (AR)' },
  { code: '+374', label: 'Armenia (AM)' },
  { code: '+297', label: 'Aruba (AW)' },
  { code: '+61', label: 'Australia (AU)' },
  { code: '+43', label: 'Austria (AT)' },
  { code: '+994', label: 'Azerbaijan (AZ)' },
  { code: '+1242', label: 'Bahamas (BS)' },
  { code: '+973', label: 'Bahrain (BH)' },
  { code: '+880', label: 'Bangladesh (BD)' },
  { code: '+1246', label: 'Barbados (BB)' },
  { code: '+375', label: 'Belarus (BY)' },
  { code: '+32', label: 'Belgium (BE)' },
  { code: '+501', label: 'Belize (BZ)' },
  { code: '+229', label: 'Benin (BJ)' },
  { code: '+1441', label: 'Bermuda (BM)' },
  { code: '+975', label: 'Bhutan (BT)' },
  { code: '+591', label: 'Bolivia (BO)' },
  { code: '+387', label: 'Bosnia and Herzegovina (BA)' },
  { code: '+267', label: 'Botswana (BW)' },
  { code: '+55', label: 'Brazil (BR)' },
  { code: '+673', label: 'Brunei (BN)' },
  { code: '+359', label: 'Bulgaria (BG)' },
  { code: '+226', label: 'Burkina Faso (BF)' },
  { code: '+257', label: 'Burundi (BI)' },
  { code: '+855', label: 'Cambodia (KH)' },
  { code: '+237', label: 'Cameroon (CM)' },
  { code: '+1', label: 'Canada (CA)' },
  { code: '+238', label: 'Cape Verde (CV)' },
  { code: '+1345', label: 'Cayman Islands (KY)' },
  { code: '+236', label: 'Central African Republic (CF)' },
  { code: '+235', label: 'Chad (TD)' },
  { code: '+56', label: 'Chile (CL)' },
  { code: '+86', label: 'China (CN)' },
  { code: '+57', label: 'Colombia (CO)' },
  { code: '+269', label: 'Comoros (KM)' },
  { code: '+242', label: 'Congo (CG)' },
  { code: '+243', label: 'Congo, DR (CD)' },
  { code: '+682', label: 'Cook Islands (CK)' },
  { code: '+506', label: 'Costa Rica (CR)' },
  { code: '+225', label: "Cote d'Ivoire (CI)" },
  { code: '+385', label: 'Croatia (HR)' },
  { code: '+53', label: 'Cuba (CU)' },
  { code: '+357', label: 'Cyprus (CY)' },
  { code: '+420', label: 'Czech Republic (CZ)' },
  { code: '+45', label: 'Denmark (DK)' },
  { code: '+253', label: 'Djibouti (DJ)' },
  { code: '+1767', label: 'Dominica (DM)' },
  { code: '+1809', label: 'Dominican Republic (DO)' },
  { code: '+593', label: 'Ecuador (EC)' },
  { code: '+20', label: 'Egypt (EG)' },
  { code: '+503', label: 'El Salvador (SV)' },
  { code: '+240', label: 'Equatorial Guinea (GQ)' },
  { code: '+291', label: 'Eritrea (ER)' },
  { code: '+372', label: 'Estonia (EE)' },
  { code: '+251', label: 'Ethiopia (ET)' },
  { code: '+679', label: 'Fiji (FJ)' },
  { code: '+358', label: 'Finland (FI)' },
  { code: '+33', label: 'France (FR)' },
  { code: '+241', label: 'Gabon (GA)' },
  { code: '+220', label: 'Gambia (GM)' },
  { code: '+995', label: 'Georgia (GE)' },
  { code: '+49', label: 'Germany (DE)' },
  { code: '+233', label: 'Ghana (GH)' },
  { code: '+350', label: 'Gibraltar (GI)' },
  { code: '+30', label: 'Greece (GR)' },
  { code: '+299', label: 'Greenland (GL)' },
  { code: '+1473', label: 'Grenada (GD)' },
  { code: '+1671', label: 'Guam (GU)' },
  { code: '+502', label: 'Guatemala (GT)' },
  { code: '+224', label: 'Guinea (GN)' },
  { code: '+245', label: 'Guinea-Bissau (GW)' },
  { code: '+592', label: 'Guyana (GY)' },
  { code: '+509', label: 'Haiti (HT)' },
  { code: '+504', label: 'Honduras (HN)' },
  { code: '+852', label: 'Hong Kong (HK)' },
  { code: '+36', label: 'Hungary (HU)' },
  { code: '+354', label: 'Iceland (IS)' },
  { code: '+91', label: 'India (IN)' },
  { code: '+62', label: 'Indonesia (ID)' },
  { code: '+98', label: 'Iran (IR)' },
  { code: '+964', label: 'Iraq (IQ)' },
  { code: '+353', label: 'Ireland (IE)' },
  { code: '+972', label: 'Israel (IL)' },
  { code: '+39', label: 'Italy (IT)' },
  { code: '+1876', label: 'Jamaica (JM)' },
  { code: '+81', label: 'Japan (JP)' },
  { code: '+962', label: 'Jordan (JO)' },
  { code: '+7', label: 'Kazakhstan (KZ)' },
  { code: '+254', label: 'Kenya (KE)' },
  { code: '+686', label: 'Kiribati (KI)' },
  { code: '+965', label: 'Kuwait (KW)' },
  { code: '+996', label: 'Kyrgyzstan (KG)' },
  { code: '+856', label: 'Laos (LA)' },
  { code: '+371', label: 'Latvia (LV)' },
  { code: '+961', label: 'Lebanon (LB)' },
  { code: '+266', label: 'Lesotho (LS)' },
  { code: '+231', label: 'Liberia (LR)' },
  { code: '+218', label: 'Libya (LY)' },
  { code: '+423', label: 'Liechtenstein (LI)' },
  { code: '+370', label: 'Lithuania (LT)' },
  { code: '+352', label: 'Luxembourg (LU)' },
  { code: '+853', label: 'Macau (MO)' },
  { code: '+389', label: 'Macedonia (MK)' },
  { code: '+261', label: 'Madagascar (MG)' },
  { code: '+265', label: 'Malawi (MW)' },
  { code: '+60', label: 'Malaysia (MY)' },
  { code: '+960', label: 'Maldives (MV)' },
  { code: '+223', label: 'Mali (ML)' },
  { code: '+356', label: 'Malta (MT)' },
  { code: '+222', label: 'Mauritania (MR)' },
  { code: '+230', label: 'Mauritius (MU)' },
  { code: '+52', label: 'Mexico (MX)' },
  { code: '+691', label: 'Micronesia (FM)' },
  { code: '+373', label: 'Moldova (MD)' },
  { code: '+377', label: 'Monaco (MC)' },
  { code: '+976', label: 'Mongolia (MN)' },
  { code: '+382', label: 'Montenegro (ME)' },
  { code: '+212', label: 'Morocco (MA)' },
  { code: '+258', label: 'Mozambique (MZ)' },
  { code: '+95', label: 'Myanmar (MM)' },
  { code: '+264', label: 'Namibia (NA)' },
  { code: '+674', label: 'Nauru (NR)' },
  { code: '+977', label: 'Nepal (NP)' },
  { code: '+31', label: 'Netherlands (NL)' },
  { code: '+64', label: 'New Zealand (NZ)' },
  { code: '+505', label: 'Nicaragua (NI)' },
  { code: '+227', label: 'Niger (NE)' },
  { code: '+234', label: 'Nigeria (NG)' },
  { code: '+850', label: 'North Korea (KP)' },
  { code: '+47', label: 'Norway (NO)' },
  { code: '+968', label: 'Oman (OM)' },
  { code: '+92', label: 'Pakistan (PK)' },
  { code: '+680', label: 'Palau (PW)' },
  { code: '+970', label: 'Palestine (PS)' },
  { code: '+507', label: 'Panama (PA)' },
  { code: '+675', label: 'Papua New Guinea (PG)' },
  { code: '+595', label: 'Paraguay (PY)' },
  { code: '+51', label: 'Peru (PE)' },
  { code: '+63', label: 'Philippines (PH)' },
  { code: '+48', label: 'Poland (PL)' },
  { code: '+351', label: 'Portugal (PT)' },
  { code: '+1787', label: 'Puerto Rico (PR)' },
  { code: '+974', label: 'Qatar (QA)' },
  { code: '+40', label: 'Romania (RO)' },
  { code: '+7', label: 'Russia (RU)' },
  { code: '+250', label: 'Rwanda (RW)' },
  { code: '+1869', label: 'Saint Kitts and Nevis (KN)' },
  { code: '+1758', label: 'Saint Lucia (LC)' },
  { code: '+1784', label: 'Saint Vincent (VC)' },
  { code: '+685', label: 'Samoa (WS)' },
  { code: '+378', label: 'San Marino (SM)' },
  { code: '+239', label: 'Sao Tome and Principe (ST)' },
  { code: '+966', label: 'Saudi Arabia (SA)' },
  { code: '+221', label: 'Senegal (SN)' },
  { code: '+381', label: 'Serbia (RS)' },
  { code: '+248', label: 'Seychelles (SC)' },
  { code: '+232', label: 'Sierra Leone (SL)' },
  { code: '+65', label: 'Singapore (SG)' },
  { code: '+421', label: 'Slovakia (SK)' },
  { code: '+386', label: 'Slovenia (SI)' },
  { code: '+677', label: 'Solomon Islands (SB)' },
  { code: '+252', label: 'Somalia (SO)' },
  { code: '+27', label: 'South Africa (ZA)' },
  { code: '+82', label: 'South Korea (KR)' },
  { code: '+211', label: 'South Sudan (SS)' },
  { code: '+34', label: 'Spain (ES)' },
  { code: '+94', label: 'Sri Lanka (LK)' },
  { code: '+249', label: 'Sudan (SD)' },
  { code: '+597', label: 'Suriname (SR)' },
  { code: '+268', label: 'Swaziland (SZ)' },
  { code: '+46', label: 'Sweden (SE)' },
  { code: '+41', label: 'Switzerland (CH)' },
  { code: '+963', label: 'Syria (SY)' },
  { code: '+886', label: 'Taiwan (TW)' },
  { code: '+992', label: 'Tajikistan (TJ)' },
  { code: '+255', label: 'Tanzania (TZ)' },
  { code: '+66', label: 'Thailand (TH)' },
  { code: '+670', label: 'Timor-Leste (TL)' },
  { code: '+228', label: 'Togo (TG)' },
  { code: '+676', label: 'Tonga (TO)' },
  { code: '+1868', label: 'Trinidad and Tobago (TT)' },
  { code: '+216', label: 'Tunisia (TN)' },
  { code: '+90', label: 'Turkey (TR)' },
  { code: '+993', label: 'Turkmenistan (TM)' },
  { code: '+256', label: 'Uganda (UG)' },
  { code: '+380', label: 'Ukraine (UA)' },
  { code: '+971', label: 'United Arab Emirates (AE)' },
  { code: '+44', label: 'United Kingdom (UK)' },
  { code: '+1', label: 'United States (US)' },
  { code: '+598', label: 'Uruguay (UY)' },
  { code: '+998', label: 'Uzbekistan (UZ)' },
  { code: '+678', label: 'Vanuatu (VU)' },
  { code: '+58', label: 'Venezuela (VE)' },
  { code: '+84', label: 'Vietnam (VN)' },
  { code: '+967', label: 'Yemen (YE)' },
  { code: '+260', label: 'Zambia (ZM)' },
  { code: '+263', label: 'Zimbabwe (ZW)' },
];

// Converts a 2-letter ISO country code (e.g. "NG") into its flag emoji.
// UK isn't a real ISO code (the real one is GB), so it's special-cased.
function getFlagEmoji(isoCode: string): string {
  const cc = isoCode.toUpperCase() === 'UK' ? 'GB' : isoCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  const codePoints = cc
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

const COUNTRY_OPTIONS = COUNTRY_CODES.map((c) => {
  const iso = c.label.match(/\(([^)]+)\)/)?.[1] || '';
  const name = c.label.replace(/\s*\([^)]+\)\s*$/, '');
  return {
    ...c,
    iso,
    name,
    flag: getFlagEmoji(iso),
  };
}).sort((a, b) => a.name.localeCompare(b.name));
// ... all your existing imports and COUNTRY_CODES/COUNTRY_OPTIONS code stays here ...

function generateKmId(): string {
      // Excludes O, 0, I, 1, L — characters that are easy to confuse with each other
      const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
      const digits = '23456789';
      const alphanumeric = letters + digits;
    
      const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
    
      const chars = [
        pick(letters),
        pick(digits),
        pick(alphanumeric),
        pick(alphanumeric),
      ];
    
      for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
    
      return 'KM-' + chars.join('');
    }
    
     
      // ... rest of your component stays exactly as is ...
export default function Signup() {
  const [step, setStep] = useState<Step>('signup');
  const [fullName, setFullName] = useState('');
  const [countryCode, setCountryCode] = useState('+234');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savedPhone, setSavedPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [otpCode, setOtpCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [resendCountdown, setResendCountdown] = useState(60);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (step === 'otp' && resendCountdown > 0) {
      timer = setInterval(() => {
        setResendCountdown((prev) => prev - 2);
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [step, resendCountdown]);

  const handleOtpChange = (value: string, index: number) => {
    if (value.length > 1) {
      const pastedDigits = value.replace(/[^0-9]/g, '').slice(0, 6).split('');
      const newOtp = [...otpCode];
      pastedDigits.forEach((digit, idx) => {
        if (index + idx < 6) {
          newOtp[index + idx] = digit;
        }
      });
      setOtpCode(newOtp);
      const nextFocusIdx = Math.min(index + pastedDigits.length, 5);
      document.getElementById(`otp-${nextFocusIdx}`)?.focus();
      return;
    }

    if (/[^0-9]/.test(value) && value !== '') return;
    const newOtp = [...otpCode];
    newOtp[index] = value;
    setOtpCode(newOtp);

    if (value && index < 5) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Backspace' && !otpCode[index] && index > 0) {
      document.getElementById(`otp-${index - 1}`)?.focus();
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 7 || cleanPhone.length > 15) {
      setErrorMsg('Please enter a valid phone number (digits only, 7-15 characters).');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    setLoadingText('Creating Account...');

    try {
      const fullPhone = `${countryCode}${cleanPhone}`;
      setSavedPhone(fullPhone);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: fullPhone,
          },
        },
      });

      if (error) {
        if (error.message.toLowerCase().includes('already registered') || error.message.toLowerCase().includes('already exists')) {
          setErrorMsg('This email is already registered.');
        } else {
          throw error;
        }
        setLoading(false);
        return;
      }

      setStep('otp');
      setResendCountdown(120);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const token = otpCode.join('');

    if (token.length < 6) {
      setErrorMsg('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    setLoadingText('Verifying...');

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'signup'
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      const kmId = generateKmId();

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(
          {
            user_id: data.user?.id,
            km_id: kmId,
            email: email,
            full_name: fullName,
            phone: savedPhone,
          },
          { onConflict: 'user_id' }
        );

      if (profileError) throw profileError;
      window.location.href = '/home';

    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid or expired verification code.');
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCountdown > 0) return;
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setResendCountdown(60);
      alert('Verification code resent successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to resend code.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-slate-950">
      <nav className="max-w-7xl w-full mx-auto px-6 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-slate-950 text-xl shadow-lg shadow-emerald-500/20">
            <span className="text-white">K</span><span className="text-slate-950">Mz</span>
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            Kool<span className="text-emerald-400">M</span>ovez
          </span>
        </div>
        {step === 'signup' && (
          <div className="text-sm text-slate-400">
            Already have an account?{' '}
            <a href="/login" className="text-emerald-400 font-semibold hover:underline">
              Sign In
            </a>
          </div>
        )}
      </nav>

      <main className="max-w-md w-full mx-auto px-6 py-8">
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-3xl shadow-2xl shadow-black/50 relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none"></div>

          {errorMsg && (
            <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-medium flex flex-col gap-2">
              <span>{errorMsg}</span>
              {errorMsg.includes('already registered') && (
                <a href="/login" className="text-emerald-400 font-semibold hover:underline">
                  Sign In &rarr;
                </a>
              )}
            </div>
          )}

          {step === 'signup' && (
            <>
              <div className="mb-8 space-y-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">Create your account</h1>
                <p className="text-sm text-slate-400">Get started with seamless cross-border trade and payments.</p>
              </div>

              <form onSubmit={handleSignupSubmit} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Full Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ismaila Ogundepo"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 h-12 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 h-12 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <p className="text-[11px] text-slate-500 pt-0.5">We'll send a verification code to this email.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Phone Number</label>
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="bg-slate-950/60 border border-slate-800 rounded-xl px-3 h-12 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors max-w-[45%]"
                    >
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.iso || c.label} value={c.code}>
                          {c.flag} {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      required
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="8000000000"
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 h-12 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 h-12 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Confirm Password</label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 h-12 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition-colors pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                    >
                      {showConfirmPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold h-12 rounded-xl transition-all shadow-lg shadow-emerald-500/10 hover:opacity-95 active:scale-[0.99] flex items-center justify-center disabled:opacity-50"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                      <span>{loadingText}</span>
                    </div>
                  ) : (
                    'Create Account'
                  )}
                </button>
              </form>
            </>
          )}

          {step === 'otp' && (
            <div className="space-y-6">
              <div className="space-y-2 text-center">
                <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold mb-4">
                  
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Check your email</h1>
                <p className="text-sm text-slate-400">
                  Enter the 6-digit verification code to verify the email sent to <span className="text-white font-medium">{email}</span>.
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="flex justify-between gap-2">
                  {otpCode.map((digit, idx) => (
                    <input
                      key={idx}
                      id={`otp-${idx}`}
                      type="text"
                      maxLength={6}
                      value={digit}
                      onChange={(e) => handleOtpChange(e.target.value, idx)}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                      className="w-12 h-14 text-center bg-slate-950/80 border border-slate-800 rounded-xl text-xl font-bold text-emerald-400 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold h-12 rounded-xl transition-all shadow-lg shadow-emerald-500/10 hover:opacity-95 active:scale-[0.99] flex items-center justify-center disabled:opacity-50"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                      <span>{loadingText}</span>
                    </div>
                  ) : (
                    'Verify Email'
                  )}
                </button>
              </form>

              <div className="text-center text-xs text-slate-400">
                {resendCountdown > 0 ? (
                  <span>Resend in {resendCountdown}s</span>
                ) : (
                  <span>
                    Didn't receive the code?{' '}
                    <button onClick={handleResendOtp} className="text-emerald-400 font-semibold hover:underline">
                      Resend Code
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 text-center text-xs text-slate-500">
            By continuing you agree to our <br />
            <a href="/terms" className="text-slate-400 hover:underline">Terms</a> &bull; <a href="/privacy" className="text-slate-400 hover:underline">Privacy Policy</a>
          </div>
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-slate-600">
        &copy; {new Date().getFullYear()} KoolMovez. All rights reserved.
      </footer>
    </div>
  );
}