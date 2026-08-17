/*
    Email templates

    Responsibilities:
    - Define pure functions that return `{ subject, html, text }` for each
      notification type.
    - Keep all email rendering logic here so the notification worker only needs
      to call `template(data)` and pass the result to `sendMail`.

    Design notes:
    - Templates use inline CSS rather than a CSS file because many email clients
      (especially Gmail) strip linked stylesheets. Inline styles are the only
      reliable cross-client styling method.
    - A plain-text (`text`) version accompanies every HTML email. This ensures
      deliverability and accessibility for clients that don't render HTML.
    - All monetary values are formatted to 2 decimal places.
    - IST timestamp formatting is used since the platform trades in IST hours.
*/

// ─────────────────────────────────────────────────────────────────────────────
// Shared layout helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps `bodyHtml` in a full HTML document with a consistent Stockey header
 * and footer. All transactional emails use this wrapper.
 *
 * @param {string} bodyHtml - The content to place inside the email body.
 * @returns {string} Complete HTML document string.
 */
function emailLayout(bodyHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stockey</title>
</head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;">
  <!-- Outer wrapper — centres the email card in wide clients -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:#0f0f13;padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Email card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#1a1a2e;border-radius:12px;
                      border:1px solid #2d2d4a;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);
                        padding:28px 32px;text-align:center;">
              <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;
                          letter-spacing:-0.5px;">
                📈 Stockey
              </h1>
              <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">
                Simulated Stock Exchange
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #2d2d4a;
                        text-align:center;font-size:12px;color:#6b7280;">
              This is an automated notification from Stockey.<br />
              You are receiving this because you have an active trading account.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Format a number as a currency string with 2 decimal places.
 * e.g.  1234.5  →  "₹1,234.50"
 *
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
    return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a Date (or ISO string) in IST with a human-readable format.
 * e.g.  "11 Aug 2026, 2:33 PM IST"
 *
 * @param {Date|string} date
 * @returns {string}
 */
function formatDateIST(date) {
    return new Date(date).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }) + ' IST';
}

// Escape user-controlled values before interpolating into HTML email bodies so
// a crafted value cannot inject markup or scripts into brand-trusted emails.
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 1: Trade Confirmation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the trade confirmation email sent to both buyer and seller after
 * a trade is executed by the matching engine.
 *
 * @param {object} params
 * @param {string}  params.side         - 'buy' or 'sell' (from the recipient's perspective)
 * @param {string}  params.stockSymbol  - e.g. 'AAPL'
 * @param {number}  params.quantity     - Shares traded
 * @param {number}  params.price        - Execution price per share
 * @param {number}  params.total        - quantity × price
 * @param {string}  params.orderId      - The user's order ID
 * @param {string}  params.executedAt   - ISO timestamp of trade execution
 *
 * @returns {{ subject: string, html: string, text: string }}
 */
export function tradeConfirmationEmail({ side, stockSymbol, quantity, price, total, orderId, executedAt }) {
    // Decide display values based on whether the user was the buyer or seller.
    const actionVerb = side === 'buy' ? 'Bought' : 'Sold';
    const actionColor = side === 'buy' ? '#22c55e' : '#ef4444';   // green / red
    const actionEmoji = side === 'buy' ? '🟢' : '🔴';

    const subject = `${actionEmoji} Trade Executed — ${actionVerb} ${quantity} × ${escapeHtml(stockSymbol)}`;

    const html = emailLayout(`
      <!-- Headline -->
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">
        Trade Confirmed ✅
      </h2>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;">
        Your order has been matched and executed successfully.
      </p>

      <!-- Trade summary card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#0f172a;border-radius:8px;border:1px solid #2d2d4a;
                    margin-bottom:24px;">
        <tr>
          <!-- Side badge -->
          <td colspan="2" style="padding:16px 20px;border-bottom:1px solid #2d2d4a;">
            <span style="background:${actionColor}22;color:${actionColor};
                          font-weight:700;font-size:13px;padding:4px 12px;
                          border-radius:20px;border:1px solid ${actionColor}44;">
              ${actionVerb} ${escapeHtml(stockSymbol)}
            </span>
          </td>
        </tr>

        <!-- Quantity row -->
        <tr>
          <td style="padding:12px 20px;color:#94a3b8;font-size:13px;">Quantity</td>
          <td style="padding:12px 20px;color:#f1f5f9;font-size:14px;font-weight:600;text-align:right;">
            ${quantity.toLocaleString('en-IN')} shares
          </td>
        </tr>

        <!-- Price per share row -->
        <tr style="background:#ffffff08;">
          <td style="padding:12px 20px;color:#94a3b8;font-size:13px;">Price per share</td>
          <td style="padding:12px 20px;color:#f1f5f9;font-size:14px;font-weight:600;text-align:right;">
            ${formatCurrency(price)}
          </td>
        </tr>

        <!-- Total row -->
        <tr>
          <td style="padding:12px 20px;color:#94a3b8;font-size:13px;">Total value</td>
          <td style="padding:12px 20px;color:${actionColor};font-size:16px;font-weight:700;text-align:right;">
            ${formatCurrency(total)}
          </td>
        </tr>

        <!-- Executed at row -->
        <tr style="background:#ffffff08;">
          <td style="padding:12px 20px;color:#94a3b8;font-size:13px;">Executed at</td>
          <td style="padding:12px 20px;color:#f1f5f9;font-size:13px;text-align:right;">
            ${formatDateIST(executedAt)}
          </td>
        </tr>

        <!-- Order ID row (for reference) -->
        <tr>
          <td style="padding:12px 20px;color:#94a3b8;font-size:13px;">Order ID</td>
          <td style="padding:12px 20px;color:#6366f1;font-size:11px;
                      font-family:monospace;text-align:right;word-break:break-all;">
            ${escapeHtml(orderId)}
          </td>
        </tr>
      </table>

      <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
        Your account balance and portfolio have been updated to reflect this trade.
        Log in to Stockey to view your current portfolio.
      </p>
    `);

    // Plain-text fallback for email clients that don't render HTML.
    const text = [
        `Trade Confirmed — ${actionVerb} ${stockSymbol}`,
        '',
        `Action:          ${actionVerb}`,
        `Stock:           ${stockSymbol}`,
        `Quantity:        ${quantity} shares`,
        `Price per share: ${formatCurrency(price)}`,
        `Total value:     ${formatCurrency(total)}`,
        `Executed at:     ${formatDateIST(executedAt)}`,
        `Order ID:        ${orderId}`,
        '',
        'Your account balance and portfolio have been updated.',
    ].join('\n');

    return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 2: OTP Email
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the OTP verification email for sensitive actions.
 *
 * @param {object} params
 * @param {string}  params.otp     - The 6-digit one-time password
 * @param {string}  params.action  - Human-readable description of what the OTP
 *                                   is protecting, e.g. "withdraw funds" or
 *                                   "change your password"
 *
 * @returns {{ subject: string, html: string, text: string }}
 */
export function otpEmail({ otp, action }) {
    // The OTP deliberately does NOT go in the subject line to avoid leaking it
    // via subject previews/archives; it only appears in the body.
    const subject = `🔐 Your Stockey verification code`;

    const html = emailLayout(`
      <!-- Headline -->
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">
        Verification Code
      </h2>
      <p style="margin:0 0 28px;color:#94a3b8;font-size:14px;line-height:1.6;">
        You requested a one-time password to <strong style="color:#e2e8f0;">${escapeHtml(action)}</strong>.
        Enter the code below to continue. It expires in <strong style="color:#e2e8f0;">10 minutes</strong>.
      </p>

      <!-- OTP display box -->
      <div style="background:#0f172a;border:2px solid #6366f1;border-radius:12px;
                  padding:28px;text-align:center;margin-bottom:28px;">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;
                   text-transform:uppercase;letter-spacing:2px;">
          Your code
        </p>
        <!-- Each digit is displayed in a monospace block for readability. -->
        <p style="margin:0;font-size:42px;font-weight:700;letter-spacing:12px;
                   color:#6366f1;font-family:'Courier New',monospace;">
          ${otp}
        </p>
      </div>

      <!-- Security notice -->
      <div style="background:#7c3aed22;border:1px solid #7c3aed44;border-radius:8px;
                  padding:14px 16px;">
        <p style="margin:0;font-size:12px;color:#a78bfa;line-height:1.6;">
          ⚠️ <strong>Security notice:</strong> Stockey will never ask for this
          code over phone or chat. If you did not request this code, please
          ignore this email — your account is safe.
        </p>
      </div>
    `);

    const text = [
        `Your Stockey verification code`,
        '',
        `You requested a one-time password to ${action}.`,
        '',
        `  Code: ${otp}`,
        '',
        `This code expires in 10 minutes.`,
        '',
        'If you did not request this code, ignore this email — your account is safe.',
    ].join('\n');

    return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template 3: Daily P&L Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the daily portfolio P&L summary email sent after market close.
 *
 * @param {object}   params
 * @param {string}   params.email         - User's email address
 * @param {number}   params.cashBalance   - Current cash balance
 * @param {Array}    params.holdings      - Array of portfolio holdings
 * @param {string}   params.holdings[].stock_symbol
 * @param {number}   params.holdings[].quantity
 * @param {number}   params.holdings[].avg_buy_price
 * @param {number}   params.holdings[].current_price  - Last trade price for the stock
 * @param {number}   params.holdings[].pnl            - P&L for this holding
 * @param {number}   params.totalPnl     - Total unrealised P&L across all holdings
 * @param {string}   params.date         - The trading date (ISO string)
 *
 * @returns {{ subject: string, html: string, text: string }}
 */
export function dailyPnlEmail({ email, cashBalance, holdings, totalPnl, date }) {
    const pnlPositive = totalPnl >= 0;
    const pnlColor = pnlPositive ? '#22c55e' : '#ef4444';
    const pnlSign = pnlPositive ? '+' : '';
    const dateLabel = formatDateIST(date).split(',')[0]; // e.g. "11 Aug 2026"

    const subject = `📊 Daily Portfolio Summary — ${escapeHtml(dateLabel)} | ${pnlSign}${formatCurrency(totalPnl)}`;

    // Build a table row for each holding.
    const holdingRows = holdings.map((h, i) => {
        const holdingPnl = h.pnl ?? 0;
        const holdingPnlPositive = holdingPnl >= 0;
        const holdingPnlColor = holdingPnlPositive ? '#22c55e' : '#ef4444';
        const holdingPnlSign = holdingPnlPositive ? '+' : '';
        const rowBg = i % 2 === 0 ? '' : 'background:#ffffff06;';

        return `
          <tr style="${rowBg}">
            <td style="padding:10px 16px;color:#f1f5f9;font-weight:600;font-size:13px;">
              ${escapeHtml(h.stock_symbol)}
            </td>
            <td style="padding:10px 16px;color:#94a3b8;font-size:13px;text-align:right;">
              ${Number(h.quantity).toLocaleString('en-IN')}
            </td>
            <td style="padding:10px 16px;color:#94a3b8;font-size:13px;text-align:right;">
              ${formatCurrency(h.avg_buy_price)}
            </td>
            <td style="padding:10px 16px;color:#f1f5f9;font-size:13px;text-align:right;">
              ${formatCurrency(h.current_price)}
            </td>
            <td style="padding:10px 16px;color:${holdingPnlColor};font-size:13px;
                        font-weight:600;text-align:right;">
              ${holdingPnlSign}${formatCurrency(holdingPnl)}
            </td>
          </tr>`;
    }).join('');

    // If the user has no holdings, show a placeholder row.
    const holdingsSection = holdings.length > 0
        ? `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="background:#0f172a;border-radius:8px;border:1px solid #2d2d4a;
                         margin-bottom:24px;border-collapse:collapse;">
            <!-- Table header -->
            <tr style="border-bottom:1px solid #2d2d4a;">
              <th style="padding:10px 16px;color:#64748b;font-size:11px;text-transform:uppercase;
                          letter-spacing:1px;text-align:left;font-weight:600;">Symbol</th>
              <th style="padding:10px 16px;color:#64748b;font-size:11px;text-transform:uppercase;
                          letter-spacing:1px;text-align:right;font-weight:600;">Qty</th>
              <th style="padding:10px 16px;color:#64748b;font-size:11px;text-transform:uppercase;
                          letter-spacing:1px;text-align:right;font-weight:600;">Avg Cost</th>
              <th style="padding:10px 16px;color:#64748b;font-size:11px;text-transform:uppercase;
                          letter-spacing:1px;text-align:right;font-weight:600;">LTP</th>
              <th style="padding:10px 16px;color:#64748b;font-size:11px;text-transform:uppercase;
                          letter-spacing:1px;text-align:right;font-weight:600;">P&amp;L</th>
            </tr>
            ${holdingRows}
          </table>`
        : `<p style="color:#64748b;font-size:13px;text-align:center;
                      padding:20px;background:#0f172a;border-radius:8px;
                      border:1px solid #2d2d4a;margin-bottom:24px;">
             No open positions. Start trading to build your portfolio!
           </p>`;

    const html = emailLayout(`
      <!-- Headline -->
      <h2 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#f1f5f9;">
        Daily Portfolio Summary
      </h2>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:13px;">
        Market closed for ${escapeHtml(dateLabel)}
      </p>

      <!-- Total P&L hero card -->
      <div style="background:#0f172a;border:1px solid ${pnlColor}44;border-radius:10px;
                  padding:20px;text-align:center;margin-bottom:24px;">
        <p style="margin:0 0 4px;color:#94a3b8;font-size:12px;
                   text-transform:uppercase;letter-spacing:1.5px;">
          Total Unrealised P&amp;L
        </p>
        <p style="margin:0;font-size:32px;font-weight:700;color:${pnlColor};">
          ${pnlSign}${formatCurrency(totalPnl)}
        </p>
        <p style="margin:6px 0 0;color:#64748b;font-size:12px;">
          Cash available: ${formatCurrency(cashBalance)}
        </p>
      </div>

      <!-- Holdings table -->
      ${holdingsSection}

      <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">
        LTP = Last Traded Price. P&amp;L is unrealised and based on the last
        execution price for each stock during today's session.
      </p>
    `);

    // Plain-text fallback.
    const holdingsText = holdings.length > 0
        ? holdings.map(h => {
            const pnlSign = (h.pnl ?? 0) >= 0 ? '+' : '';
            return `  ${h.stock_symbol.padEnd(10)} Qty: ${String(h.quantity).padStart(8)}  Avg: ${formatCurrency(h.avg_buy_price).padStart(12)}  LTP: ${formatCurrency(h.current_price).padStart(12)}  P&L: ${pnlSign}${formatCurrency(h.pnl ?? 0)}`;
        }).join('\n')
        : '  No open positions.';

    const text = [
        `Daily Portfolio Summary — ${dateLabel}`,
        '',
        `Total Unrealised P&L: ${pnlSign}${formatCurrency(totalPnl)}`,
        `Cash available:       ${formatCurrency(cashBalance)}`,
        '',
        'Holdings:',
        holdingsText,
        '',
        'LTP = Last Traded Price.',
    ].join('\n');

    return { subject, html, text };
}
