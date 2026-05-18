// --- Hàm tải Lịch Sử Admin theo API Key ---
async function loadAdminHistory() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    if (!apiKey) {
        alert("Vui lòng nhập API Key!");
        return;
    }

    try {
        const res = await fetch(`/admin/history?apiKey=${encodeURIComponent(apiKey)}`);
        const result = await res.json();

        if (!result.success) {
            alert("Lỗi server: " + (result.error || "Không lấy được dữ liệu"));
            return;
        }

        const tableBody = document.getElementById('historyTableBody');
        tableBody.innerHTML = ''; // Xóa dữ liệu cũ

        result.data.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.user || ''}</td>
                <td>${item.service || ''}</td>
                <td>${item.network || ''}</td>
                <td>${item.simNumber || ''}</td>
                <td>${item.price || ''}</td>
                <td>${item.status || ''}</td>
                <td>${item.otp || ''}</td>
                <td>${new Date(item.createdAt).toLocaleString()}</td>
            `;
            tableBody.appendChild(row);
        });
    } catch (err) {
        console.error(err);
        alert("Lỗi kết nối server");
    }
}

// --- Các JS khác của bạn vẫn giữ nguyên ---
// Ví dụ: quản lý tab admin, click, filter khác...
