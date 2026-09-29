const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const BASE_URL = 'https://gql.tokopedia.com/graphql';
const VERSION = '4eb557e';

const COMMON_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Sec-Ch-Ua': '"Chromium";v="137", "Not/A)Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?1',
    'Sec-Ch-Ua-Platform': '"Android"',
    'X-Source': 'tokopedia-lite',
    'X-Device': 'tokopedia-lite',
    'X-Tkpd-Lite-Service': 'oauth',
    'X-Version': VERSION,
    'Origin': 'https://www.tokopedia.com',
    'Referer': 'https://www.tokopedia.com/register'
};

function cleanPhone(input) {
    let p = String(input || '').replace(/\D/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    if (!p.startsWith('62')) p = '62' + p;
    return '+' + p;
}

async function gql(operationName, variables, extraHeaders = {}) {
    const body = [{ operationName, variables, query: null }];
    const res = await fetch(`${BASE_URL}/${operationName}`, {
        method: 'POST',
        headers: { ...COMMON_HEADERS, ...extraHeaders },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return {
        status: res.status,
        queryhash: res.headers.get('queryhash') || '',
        body: json,
        raw: text.slice(0, 400)
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { phone, mode = 'whatsapp' } = req.body || {};
    if (!phone) {
        return res.status(400).json({ success: false, message: 'Nomor wajib diisi' });
    }

    const id = cleanPhone(phone);

    try {
        const check = await gql('checkAccount', { id });
        if (!check.body || !check.body[0]?.data?.registerCheck) {
            return res.status(200).json({
                success: false,
                step: 'checkAccount',
                message: 'Gagal cek akun',
                detail: check.raw
            });
        }

        const modeList = await gql('OTPModeListQuery', { id });
        if (!modeList.body || !modeList.body[0]?.data?.OTPModeList) {
            return res.status(200).json({
                success: false,
                step: 'OTPModeListQuery',
                message: 'Gagal ambil mode list',
                detail: modeList.raw
            });
        }

        const modes = modeList.body[0].data.OTPModeList.modeLists || [];
        const chosen = modes.find(m => m.modeText === mode) || modes[0];
        if (!chosen) {
            return res.status(200).json({
                success: false,
                step: 'selectMode',
                message: 'Mode tidak tersedia'
            });
        }

        const otp = await gql('OTPRequest', {
            id,
            modeCode: chosen.modeCode
        });

        const otpData = otp.body?.[0]?.data?.OTPRequest;
        if (otpData?.success) {
            return res.status(200).json({
                success: true,
                step: 'OTPRequest',
                message: otpData.message || 'OTP terkirim',
                phone: id,
                mode: chosen.modeText,
                modeCode: chosen.modeCode,
                raw: otpData
            });
        }

        return res.status(200).json({
            success: false,
            step: 'OTPRequest',
            message: otpData?.message || otpData?.errorMessage || 'OTP gagal dikirim',
            phone: id,
            error_code: otpData?.error_code || '',
            detail: otp.raw
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Server error: ' + err.message
        });
    }
}
