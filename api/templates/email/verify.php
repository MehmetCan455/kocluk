<?php

/**
 * E-mail verification message, Turkish.
 *
 * @var string $displayName
 * @var string $url
 */

$name = htmlspecialchars($displayName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$link = htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html>
<html lang="tr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>E-posta doğrulama</title>
</head>
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;">
        <tr>
            <td style="padding:32px 28px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827;">E-posta adresinizi doğrulayın</h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">Merhaba <?= $name ?>,</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
                    Zirve Academy hesabınızı oluşturduğunuz için teşekkürler. E-posta adresinizin size ait
                    olduğunu doğrulamak için aşağıdaki bağlantıyı açın.
                </p>
                <p style="margin:0 0 24px;">
                    <a href="<?= $link ?>" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#2563eb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">E-postamı doğrula</a>
                </p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4b5563;">
                    Bağlantı 24 saat geçerlidir ve yalnızca bir kez kullanılabilir.
                </p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4b5563;">
                    Doğrulama bu sürümde girişi engellemez; hesabınızı kullanmaya devam edebilirsiniz.
                </p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;word-break:break-all;">
                    Bağlantı açılmazsa adresi tarayıcınıza kopyalayın:<br>
                    <?= $link ?>
                </p>
            </td>
        </tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#9ca3af;text-align:center;">
        Bu e-posta Zirve Academy tarafından gönderildi. Yanıtlamayın.
    </p>
</body>
</html>
