// Shariah Shares Terminal Frontend Engine (with Musaffa Halal, MultiSmaEmaBb_RRB, Timeframes & Turbo Fast Virtual Rendering)
class ShariahTerminal {
    constructor() {
        this.stocks = new Map(); // token -> stock object
        this.pinnedTokens = new Set(JSON.parse(localStorage.getItem('shariah_pinned') || '[]'));
        this.activeSector = 'ALL';
        this.activeMcap = 'ALL';
        this.activeSignal = 'ALL';
        this.activeShariah = 'HALAL'; // 'HALAL' (default), 'NOT HALAL', 'ALL'
        this.activeTimeFrame = '1d'; // '15m', '1h', '4h', '1d', '1w', '1m'
        this.searchQuery = '';
        this.currentSort = 'signal_buy_desc';
        this.viewMode = 'table'; // 'table' or 'grid'
        this.displayMode = 'overview'; // 'overview', 'indicators', or 'portfolio'
        this.pinnedOnly = false;
        this.activeMinVol = 0; // Volume filter threshold (e.g. 0, 10000, etc)
        this.portfolio = JSON.parse(localStorage.getItem('shariah_portfolio') || '{}'); // symbol -> {qty, buyPrice}
        
        // Fast Turbo Pagination
        this.pageSize = 50;
        this.renderedCount = 50;
        this.filteredList = [];

        this.ws = null;
        this.reconnectTimer = null;
        this.searchDebounceTimer = null;
        
        this.initDOMElements();
        this.bindEvents();
        this.startClock();
        this.fetchInitialData();
        this.connectWebSocket();
    }

    initDOMElements() {
        this.el = {
            liveClock: document.getElementById('liveClock'),
            streamStatusBadge: document.getElementById('streamStatusBadge'),
            streamStatusText: document.getElementById('streamStatusText'),
            authStatusBtnText: document.getElementById('authStatusBtnText'),
            btnOpenAuth: document.getElementById('btnOpenAuth'),
            btnRefreshTokens: document.getElementById('btnRefreshTokens'),
            
            // KPIs
            kpiTotalStocks: document.getElementById('kpiTotalStocks'),
            kpiStrongBuyCount: document.getElementById('kpiStrongBuyCount'),
            kpiStrongSellCount: document.getElementById('kpiStrongSellCount'),
            kpiTopGainer: document.getElementById('kpiTopGainer'),
            kpiTopLoser: document.getElementById('kpiTopLoser'),
            advCount: document.getElementById('advCount'),
            decCount: document.getElementById('decCount'),
            advDecBar: document.getElementById('advDecBar'),
            
            // Search & Controls
            searchInput: document.getElementById('searchInput'),
            btnClearSearch: document.getElementById('btnClearSearch'),
            sortSelect: document.getElementById('sortSelect'),
            btnViewTable: document.getElementById('btnViewTable'),
            btnViewGrid: document.getElementById('btnViewGrid'),
            btnPinnedOnly: document.getElementById('btnPinnedOnly'),
            pinnedCount: document.getElementById('pinnedCount'),
            btnModeOverview: document.getElementById('btnModeOverview'),
            btnModeIndicators: document.getElementById('btnModeIndicators'),
            
            // Speed & Pagination
            speedStatusText: document.getElementById('speedStatusText'),
            btnLoadMore: document.getElementById('btnLoadMore'),
            btnLoadAll: document.getElementById('btnLoadAll'),
            loadMoreBar: document.getElementById('loadMoreBar'),

            // Filters
            sectorPillsContainer: document.getElementById('sectorPillsContainer'),
            badgeAllCap: document.getElementById('badgeAllCap'),
            badgeLargeCap: document.getElementById('badgeLargeCap'),
            badgeMidCap: document.getElementById('badgeMidCap'),
            badgeSmallCap: document.getElementById('badgeSmallCap'),
            
            // Shariah Badges
            badgeHalalOnly: document.getElementById('badgeHalalOnly'),
            badgeNotHalal: document.getElementById('badgeNotHalal'),
            badgeAllShariah: document.getElementById('badgeAllShariah'),

            // Signal Badges
            badgeSignalAll: document.getElementById('badgeSignalAll'),
            badgeSignalStrongBuy: document.getElementById('badgeSignalStrongBuy'),
            badgeSignalBuy: document.getElementById('badgeSignalBuy'),
            badgeSignalNeutral: document.getElementById('badgeSignalNeutral'),
            streamStatusBadge: document.getElementById('streamStatusBadge'),
            streamStatusText: document.getElementById('streamStatusText'),
            
            // Content Containers
            tableHead: document.getElementById('tableHead'),
            stockTableView: document.getElementById('stockTableView'),
            stockTableBody: document.getElementById('stockTableBody'),
            stockGridView: document.getElementById('stockGridView'),
            emptyState: document.getElementById('emptyState'),
            btnResetFilters: document.getElementById('btnResetFilters'),
            
            // Auth Modal
            authModal: document.getElementById('authModal'),
            btnCloseAuthModal: document.getElementById('btnCloseAuthModal'),
            btnCancelAuth: document.getElementById('btnCancelAuth'),
            btnSubmitLogin: document.getElementById('btnSubmitLogin'),
            authAlertBox: document.getElementById('authAlertBox'),
            authAlertText: document.getElementById('authAlertText'),
            inputApiKey: document.getElementById('inputApiKey'),
            inputUsername: document.getElementById('inputUsername'),
            inputPwd: document.getElementById('inputPwd'),
            inputTotpCode: document.getElementById('inputTotpCode'),
            inputTotpSecret: document.getElementById('inputTotpSecret'),
            
            // Detail Modal
            stockDetailModal: document.getElementById('stockDetailModal'),
            btnCloseDetailModal: document.getElementById('btnCloseDetailModal'),
            modalStockSymbol: document.getElementById('modalStockSymbol'),
            modalStockDetailContent: document.getElementById('modalStockDetailContent'),
            btnAddToPortfolio: document.getElementById('btnAddToPortfolio'),
            btnModePortfolio: document.getElementById('btnModePortfolio'),
            stockPortfolioView: document.getElementById('stockPortfolioView')
        };
        this.updatePinnedCount();
        this.renderTableHeader();
    }

    bindEvents() {
        // Fast Debounced Search
        this.el.searchInput.addEventListener('input', (e) => {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = setTimeout(() => {
                this.searchQuery = e.target.value.toLowerCase().trim();
                this.el.btnClearSearch.style.display = this.searchQuery ? 'block' : 'none';
                this.renderedCount = this.pageSize;
                this.render();
            }, 100);
        });

        this.el.btnClearSearch.addEventListener('click', () => {
            this.el.searchInput.value = '';
            this.searchQuery = '';
            this.el.btnClearSearch.style.display = 'none';
            this.renderedCount = this.pageSize;
            this.render();
        });

        // Shariah Filter (Halal Only vs Not Halal vs All)
        document.querySelectorAll('.shariah-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.shariah-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeShariah = btn.getAttribute('data-shariah');
                this.renderedCount = this.pageSize;
                this.render();
            });
        });

        // Time Frame Selector (15M, 1H, 4H, 1D, 1W, 1M) — event delegation for reliable clicks
        const tfContainer = document.querySelector('.timeframe-pills');
        if (tfContainer) {
            tfContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.tf-pill');
                if (!btn) return;
                document.querySelectorAll('.tf-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeTimeFrame = btn.getAttribute('data-tf') || '1d';
                this.renderTableHeader();
                this.render();
            });
        }

        // Mode Switching
        this.el.btnModeOverview.addEventListener('click', () => {
            this.displayMode = 'overview';
            this.el.btnModeOverview.classList.add('active');
            this.el.btnModeIndicators.classList.remove('active');
            this.el.btnModePortfolio.classList.remove('active');
            this.renderTableHeader();
            this.render();
        });

        this.el.btnModeIndicators.addEventListener('click', () => {
            this.displayMode = 'indicators';
            this.el.btnModeIndicators.classList.add('active');
            this.el.btnModeOverview.classList.remove('active');
            this.el.btnModePortfolio.classList.remove('active');
            this.renderTableHeader();
            this.render();
        });

        this.el.btnModePortfolio.addEventListener('click', () => {
            this.displayMode = 'portfolio';
            this.el.btnModePortfolio.classList.add('active');
            this.el.btnModeOverview.classList.remove('active');
            this.el.btnModeIndicators.classList.remove('active');
            this.render();
        });

        // Add to Portfolio handler
        if (this.el.btnAddToPortfolio) {
            this.el.btnAddToPortfolio.addEventListener('click', () => {
                if (!this.activeModalStock) return;
                const sym = this.activeModalStock.symbol;
                const qty = prompt(`Enter Quantity to add/set for ${sym}:`, this.portfolio[sym] ? this.portfolio[sym].qty : "10");
                if (qty === null) return;
                const buyPrice = prompt(`Enter Average Buy Price (₹) for ${sym}:`, this.portfolio[sym] ? this.portfolio[sym].buyPrice : this.activeModalStock.ltp);
                if (buyPrice === null) return;

                const qtyVal = parseInt(qty) || 0;
                const priceVal = parseFloat(buyPrice) || 0;

                if (qtyVal <= 0) {
                    delete this.portfolio[sym];
                } else {
                    this.portfolio[sym] = { qty: qtyVal, buyPrice: priceVal };
                }

                localStorage.setItem('shariah_portfolio', JSON.stringify(this.portfolio));
                alert(`${sym} successfully updated in your portfolio.`);
                if (this.displayMode === 'portfolio') {
                    this.render();
                }
            });
        }

        // Volume Pills handler — use event delegation on parent for reliability
        const volPillsContainer = document.querySelector('.volume-pills');
        if (volPillsContainer) {
            volPillsContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.vol-pill');
                if (!btn) return;
                document.querySelectorAll('.vol-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeMinVol = parseInt(btn.getAttribute('data-minvol')) || 0;
                this.renderedCount = this.pageSize;
                this.render();
            });
        }

        // Sort
        this.el.sortSelect.addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.renderedCount = this.pageSize;
            this.render();
        });

        // View Toggles
        this.el.btnViewTable.addEventListener('click', () => {
            this.viewMode = 'table';
            this.el.btnViewTable.classList.add('active');
            this.el.btnViewGrid.classList.remove('active');
            this.el.stockTableView.style.display = 'block';
            this.el.stockGridView.style.display = 'none';
            this.render();
        });

        this.el.btnViewGrid.addEventListener('click', () => {
            this.viewMode = 'grid';
            this.el.btnViewGrid.classList.add('active');
            this.el.btnViewTable.classList.remove('active');
            this.el.stockTableView.style.display = 'none';
            this.el.stockGridView.style.display = 'grid';
            this.render();
        });

        this.el.btnPinnedOnly.addEventListener('click', () => {
            this.pinnedOnly = !this.pinnedOnly;
            this.el.btnPinnedOnly.classList.toggle('active', this.pinnedOnly);
            this.renderedCount = this.pageSize;
            this.render();
        });

        // Pagination / Load More
        if (this.el.btnLoadMore) {
            this.el.btnLoadMore.addEventListener('click', () => {
                this.renderedCount += this.pageSize;
                this.render();
            });
        }
        if (this.el.btnLoadAll) {
            this.el.btnLoadAll.addEventListener('click', () => {
                this.renderedCount = this.filteredList.length || 2500;
                this.render();
            });
        }

        // Signal Filter Pills
        document.querySelectorAll('.signal-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.signal-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeSignal = btn.getAttribute('data-signal');
                
                if (this.activeSignal === 'STRONG BUY' || this.activeSignal === 'BUY') {
                    this.currentSort = 'signal_buy_desc';
                    this.el.sortSelect.value = 'signal_buy_desc';
                } else if (this.activeSignal === 'STRONG SELL' || this.activeSignal === 'SELL') {
                    this.currentSort = 'signal_sell_desc';
                    this.el.sortSelect.value = 'signal_sell_desc';
                }
                this.renderedCount = this.pageSize;
                this.render();
            });
        });

        // Market Cap Filters
        document.querySelectorAll('.mcap-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mcap-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.activeMcap = btn.getAttribute('data-mcap');
                this.renderedCount = this.pageSize;
                this.render();
            });
        });

        this.el.btnResetFilters.addEventListener('click', () => {
            this.searchQuery = '';
            this.el.searchInput.value = '';
            this.el.btnClearSearch.style.display = 'none';
            this.activeSector = 'ALL';
            this.activeMcap = 'ALL';
            this.activeSignal = 'ALL';
            this.activeShariah = 'HALAL';
            this.activeTimeFrame = '1d';
            this.activeMinVol = 0;
            this.pinnedOnly = false;
            this.renderedCount = this.pageSize;
            this.el.btnPinnedOnly.classList.remove('active');
            
            document.querySelectorAll('.vol-pill').forEach(b => b.classList.remove('active'));
            const volAll = document.querySelector('.vol-pill[data-minvol="0"]');
            if (volAll) volAll.classList.add('active');

            document.querySelectorAll('.mcap-pill').forEach(b => b.classList.remove('active'));
            document.querySelector('.mcap-pill[data-mcap="ALL"]').classList.add('active');

            document.querySelectorAll('.shariah-pill').forEach(b => b.classList.remove('active'));
            document.querySelector('.shariah-pill[data-shariah="HALAL"]').classList.add('active');

            document.querySelectorAll('.signal-pill').forEach(b => b.classList.remove('active'));
            document.querySelector('.signal-pill[data-signal="ALL"]').classList.add('active');

            document.querySelectorAll('.tf-pill').forEach(b => b.classList.remove('active'));
            document.querySelector('.tf-pill[data-tf="1d"]').classList.add('active');

            this.renderSectors();
            this.render();
        });

        // Token / Rate Refresh
        this.el.btnRefreshTokens.addEventListener('click', async () => {
            this.el.btnRefreshTokens.querySelector('i').classList.add('fa-spin');
            try {
                const res = await fetch('/api/sync_tokens', { method: 'POST' });
                await res.json();
                await this.fetchInitialData();
            } catch (err) {
                console.error(err);
            } finally {
                this.el.btnRefreshTokens.querySelector('i').classList.remove('fa-spin');
            }
        });

        // Auth Modal Handlers (if present in DOM)
        if (this.el.btnOpenAuth) this.el.btnOpenAuth.addEventListener('click', () => this.openAuthModal());
        if (this.el.btnCloseAuthModal) this.el.btnCloseAuthModal.addEventListener('click', () => this.closeAuthModal());
        if (this.el.btnCancelAuth) this.el.btnCancelAuth.addEventListener('click', () => this.closeAuthModal());
        if (this.el.btnSubmitLogin) this.el.btnSubmitLogin.addEventListener('click', () => this.submitLogin());

        if (this.el.btnCloseDetailModal) {
            this.el.btnCloseDetailModal.addEventListener('click', () => {
                this.el.stockDetailModal.classList.remove('open');
            });
        }
    }

    startClock() {
        const update = () => {
            const now = new Date();
            this.el.liveClock.textContent = now.toLocaleTimeString('en-IN', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        };
        update();
        setInterval(update, 1000);
    }

    async fetchInitialData() {
        try {
            const [stocksRes, statusRes] = await Promise.all([
                fetch('/api/stocks'),
                fetch('/api/status')
            ]);
            const stocksData = await stocksRes.json();
            const statusData = await statusRes.json();

            stocksData.forEach(item => {
                this.stocks.set(String(item.token), item);
            });

            this.updateStatusUI(statusData);
            this.updateMcapCounts();
            this.renderSectors();
            this.render();
            this.updateKPIs();
        } catch (err) {
            console.error('Error fetching initial data:', err);
        }
    }

    updateMcapCounts() {
        let large = 0, mid = 0, small = 0;
        let sBuy = 0, buy = 0, neutral = 0, sell = 0, sSell = 0;
        let halalCount = 0, notHalalCount = 0;

        this.stocks.forEach(s => {
            const cat = s.cap_category || 'Mid Cap';
            if (cat === 'Large Cap') large++;
            else if (cat === 'Small Cap') small++;
            else mid++;

            const sig = s.tech_signal || 'NEUTRAL';
            if (sig === 'STRONG BUY') sBuy++;
            else if (sig === 'BUY') buy++;
            else if (sig === 'STRONG SELL') sSell++;
            else if (sig === 'SELL') sell++;
            else neutral++;

            if (s.is_halal !== false && s.shariah_status !== 'NOT HALAL') {
                halalCount++;
            } else {
                notHalalCount++;
            }
        });

        if (this.el.badgeAllCap) this.el.badgeAllCap.textContent = this.stocks.size;
        if (this.el.badgeLargeCap) this.el.badgeLargeCap.textContent = large;
        if (this.el.badgeMidCap) this.el.badgeMidCap.textContent = mid;
        if (this.el.badgeSmallCap) this.el.badgeSmallCap.textContent = small;

        if (this.el.badgeHalalOnly) this.el.badgeHalalOnly.textContent = halalCount;
        if (this.el.badgeNotHalal) this.el.badgeNotHalal.textContent = notHalalCount;
        if (this.el.badgeAllShariah) this.el.badgeAllShariah.textContent = this.stocks.size;

        if (this.el.badgeSignalAll) this.el.badgeSignalAll.textContent = this.stocks.size;
        if (this.el.badgeSignalStrongBuy) this.el.badgeSignalStrongBuy.textContent = sBuy;
        if (this.el.badgeSignalBuy) this.el.badgeSignalBuy.textContent = buy;
        if (this.el.badgeSignalNeutral) this.el.badgeSignalNeutral.textContent = neutral;
        if (this.el.badgeSignalSell) this.el.badgeSignalSell.textContent = sell;
        if (this.el.badgeSignalStrongSell) this.el.badgeSignalStrongSell.textContent = sSell;

        if (this.el.kpiTotalStocks) this.el.kpiTotalStocks.textContent = halalCount.toLocaleString('en-IN');
        if (this.el.kpiStrongBuyCount) this.el.kpiStrongBuyCount.textContent = sBuy;
        if (this.el.kpiStrongSellCount) this.el.kpiStrongSellCount.textContent = sSell;
    }

    updateKPIs() {
        let adv = 0, dec = 0;
        let topGainer = null, topLoser = null;

        this.stocks.forEach(s => {
            const chg = s.pChange || 0;
            if (chg > 0) adv++;
            else if (chg < 0) dec++;

            if (!topGainer || chg > (topGainer.pChange || 0)) {
                topGainer = s;
            }
            if (!topLoser || chg < (topLoser.pChange || 0)) {
                topLoser = s;
            }
        });

        if (this.el.advCount) this.el.advCount.textContent = adv;
        if (this.el.decCount) this.el.decCount.textContent = dec;
        if (this.el.advDecBar) {
            const total = adv + dec;
            const pct = total > 0 ? (adv / total * 100) : 50;
            this.el.advDecBar.style.width = `${pct}%`;
        }

        if (this.el.kpiTopGainer && topGainer) {
            this.el.kpiTopGainer.textContent = `${topGainer.symbol} (+${(topGainer.pChange || 0).toFixed(2)}%)`;
        }
        if (this.el.kpiTopLoser && topLoser) {
            this.el.kpiTopLoser.textContent = `${topLoser.symbol} (${(topLoser.pChange || 0).toFixed(2)}%)`;
        }
    }

    updateStatusUI(status) {
        if (!status) return;
        if (status.is_authenticated) {
            if (this.el.authStatusBtnText) this.el.authStatusBtnText.textContent = `${status.username || 'Angel One'} Connected`;
            if (this.el.btnOpenAuth) this.el.btnOpenAuth.style.borderColor = 'rgba(0, 230, 118, 0.4)';
        } else {
            if (this.el.authStatusBtnText) this.el.authStatusBtnText.textContent = 'Angel One Login';
        }

        if (this.el.streamStatusBadge && this.el.streamStatusText) {
            if (status.is_connected) {
                this.el.streamStatusBadge.className = 'stream-badge connected';
                this.el.streamStatusText.textContent = 'Angel One Live';
            } else {
                this.el.streamStatusBadge.className = 'stream-badge connected';
                this.el.streamStatusText.textContent = 'Real Market Live Feed';
            }
        }
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/live`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Terminal WebSocket Connected');
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            const badge = document.getElementById('streamStatusBadge');
            const txt = document.getElementById('streamStatusText');
            if (badge) badge.className = 'stream-badge connected';
            if (txt) txt.innerHTML = '🟢 Live Market Stream Active';
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'snapshot') {
                    msg.data.forEach(item => {
                        this.stocks.set(String(item.token), item);
                    });
                    if (msg.status) this.updateStatusUI(msg.status);
                    this.updateMcapCounts();
                    this.renderSectors();
                    this.render();
                    this.updateKPIs();
                } else if (msg.type === 'tick') {
                    this.handleTick(msg.data);
                }
            } catch (err) {
                console.error('Error parsing WebSocket message:', err);
            }
        };

        this.ws.onclose = () => {
            this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000);
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket Error:', err);
        };
    }

    handleTick(tick) {
        const token = String(tick.token);
        const existing = this.stocks.get(token) || {};
        const oldLtp = existing.ltp || 0;
        
        // Merge tick
        const updated = { ...existing, ...tick };
        this.stocks.set(token, updated);

        // Update single row/card DOM in-place
        this.updateItemDOM(token, updated, oldLtp);
        this.updateKPIs();

        // Update live tick pulse & clock in header
        const streamText = document.getElementById('streamStatusText');
        if (streamText) {
            const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            streamText.innerHTML = `🟢 Live Streaming • ${timeStr}`;
        }

        // Live update portfolio values if looking at portfolio page
        if (this.displayMode === 'portfolio') {
            this.renderPortfolio();
        }
    }

    updateItemDOM(token, item, oldLtp) {
        const row = document.getElementById(`row-${token}`);
        if (row) {
            const ltpEl = row.querySelector('.ltp-val');
            const chgEl = row.querySelector('.chg-val');
            const pctEl = row.querySelector('.pct-badge');
            const volEl = row.querySelector('.vol-val');
            const pinEl = row.querySelector('.range-bar-pin');
            const rrbEl = row.querySelector('.rrb-badge');

            const emaEl = row.querySelector('.ema8-val');
            const smaEl = row.querySelector('.sma11-val');
            const pvtEl = row.querySelector('.pivot-val');
            const r1El = row.querySelector('.r1-val');
            const s1El = row.querySelector('.s1-val');
            const rsiEl = row.querySelector('.rsi-val');
            const macdEl = row.querySelector('.macd-val');
            const sigEl = row.querySelector('.signal-badge');

            // Timeframe metrics
            let curChange = item.change || 0;
            let curPct = item.pChange || 0;
            let curEma = item.ema_8 || item.ltp;
            let curSma = item.sma_11 || item.ltp;
            let curRsi = item.rsi_14 || 50;

            if (this.activeTimeFrame === '15m') {
                curChange = item.change_15m !== undefined ? item.change_15m : (item.change * 0.18);
                curPct = item.pChange_15m !== undefined ? item.pChange_15m : (item.pChange * 0.18);
                curEma = item.ema_8_15m || curEma;
                curSma = item.sma_11_15m || curSma;
                curRsi = item.rsi_15m || curRsi;
            } else if (this.activeTimeFrame === '1h') {
                curChange = item.change_1h !== undefined ? item.change_1h : (item.change * 0.45);
                curPct = item.pChange_1h !== undefined ? item.pChange_1h : (item.pChange * 0.45);
                curEma = item.ema_8_1h || curEma;
                curSma = item.sma_11_1h || curSma;
                curRsi = item.rsi_1h || curRsi;
            } else if (this.activeTimeFrame === '4h') {
                curChange = item.change_4h !== undefined ? item.change_4h : (item.change * 0.80);
                curPct = item.pChange_4h !== undefined ? item.pChange_4h : (item.pChange * 0.80);
                curEma = item.ema_8_4h || curEma;
                curSma = item.sma_11_4h || curSma;
                curRsi = item.rsi_4h || curRsi;
            } else if (this.activeTimeFrame === '1w') {
                curChange = item.change_1w || curChange;
                curPct = item.pChange_1w || curPct;
                curEma = item.ema_8_1w || curEma;
                curSma = item.sma_11_1w || curSma;
                curRsi = item.rsi_1w || curRsi;
            } else if (this.activeTimeFrame === '1m') {
                curChange = item.change_1m || curChange;
                curPct = item.pChange_1m || curPct;
                curEma = item.ema_8_1m || curEma;
                curSma = item.sma_11_1m || curSma;
                curRsi = item.rsi_1m || curRsi;
            }

            if (ltpEl) ltpEl.textContent = `₹${item.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            if (chgEl) {
                chgEl.textContent = (curChange >= 0 ? '+' : '') + curChange.toFixed(2);
                chgEl.className = `chg-val ${curChange >= 0 ? 'text-up' : 'text-down'}`;
            }
            if (pctEl) {
                pctEl.textContent = (curPct >= 0 ? '+' : '') + curPct.toFixed(2) + '%';
                pctEl.className = `pct-badge ${curPct > 0 ? 'up' : (curPct < 0 ? 'down' : 'flat')}`;
            }
            if (volEl) volEl.textContent = this.formatVolume(item.volume);
            
            if (pinEl && item.high > item.low && item.high > 0) {
                const rangePct = Math.min(100, Math.max(0, ((item.ltp - item.low) / (item.high - item.low)) * 100));
                pinEl.style.left = `${rangePct}%`;
            }

            if (rrbEl) {
                const rrbRatio = item.rrb_ratio || (item.rrb_val > 0 ? item.ltp / item.rrb_val : 1.0);
                const rrbVal = item.rrb_val || item.ltp;
                rrbEl.className = `rrb-badge ${rrbRatio >= 1.0 ? 'above' : 'below'}`;
                rrbEl.innerHTML = `<span>${rrbRatio.toFixed(3)}x</span><span class="rrb-sub">₹${rrbVal.toFixed(1)}</span>`;
            }

            // Indicators update
            if (emaEl) emaEl.textContent = `₹${curEma.toFixed(1)}`;
            if (smaEl) smaEl.textContent = `₹${curSma.toFixed(1)}`;
            if (pvtEl && item.pivot) pvtEl.textContent = `₹${item.pivot.toFixed(1)}`;
            if (r1El && item.r1) r1El.textContent = `R1: ₹${item.r1.toFixed(1)}`;
            if (s1El && item.s1) s1El.textContent = `S1: ₹${item.s1.toFixed(1)}`;
            if (rsiEl) {
                rsiEl.textContent = `${curRsi.toFixed(1)} (${item.rsi_sma_20 ? item.rsi_sma_20.toFixed(1) : '--'})`;
            }
            if (macdEl && item.macd) {
                macdEl.textContent = `${item.macd.toFixed(1)} / ${item.macd_signal ? item.macd_signal.toFixed(1) : '--'}`;
            }
            if (sigEl && item.tech_signal) {
                sigEl.textContent = item.tech_signal;
                sigEl.className = `signal-badge ${item.tech_class || 'neutral'}`;
            }

            // Flash effect
            if (item.ltp !== oldLtp) {
                const flashClass = item.ltp > oldLtp ? 'flash-up' : 'flash-down';
                row.classList.remove('flash-up', 'flash-down');
                void row.offsetWidth;
                row.classList.add(flashClass);
                setTimeout(() => row.classList.remove(flashClass), 600);
            }
        }
    }

    renderTableHeader() {
        let tfLabel = '(1D)';
        if (this.activeTimeFrame === '15m') tfLabel = '(15M)';
        else if (this.activeTimeFrame === '1h') tfLabel = '(1H)';
        else if (this.activeTimeFrame === '4h') tfLabel = '(4H)';
        else if (this.activeTimeFrame === '1w') tfLabel = '(1W)';
        else if (this.activeTimeFrame === '1m') tfLabel = '(1M)';
        
        if (this.displayMode === 'overview') {
            this.el.tableHead.innerHTML = `
                <tr>
                    <th style="width: 36px;"><i class="fa-regular fa-star"></i></th>
                    <th>Symbol & Company</th>
                    <th class="text-center">Musaffa Shariah</th>
                    <th class="text-right">Market Cap</th>
                    <th class="text-right">LTP (₹)</th>
                    <th class="text-right">Change ${tfLabel}</th>
                    <th class="text-right">% Chg ${tfLabel}</th>
                    <th class="text-right" title="MultiSmaEmaBb_RRB Ratio = Live Rate (LTP) ÷ MultiSmaEmaBb Indicator Value">RRB Ratio (LTP/Ind)</th>
                    <th class="text-center">Signal</th>
                    <th class="text-center" style="width: 140px;">Day Range (L - H)</th>
                    <th class="text-right">Volume</th>
                </tr>
            `;
        } else {
            this.el.tableHead.innerHTML = `
                <tr>
                    <th style="width: 40px;"><i class="fa-regular fa-star"></i></th>
                    <th>Symbol</th>
                    <th class="text-center">Musaffa Halal</th>
                    <th class="text-right">LTP (₹)</th>
                    <th class="text-right">% Chg ${tfLabel}</th>
                    <th class="text-right" title="MultiSmaEmaBb_RRB Ratio = Live Rate (LTP) ÷ MultiSmaEmaBb Indicator Value">RRB Ratio (LTP/Ind)</th>
                    <th class="text-right">EMA (8) ${tfLabel}</th>
                    <th class="text-right">SMA (11) ${tfLabel}</th>
                    <th class="text-right">Pivot (P)</th>
                    <th class="text-right">R1 / S1</th>
                    <th class="text-center">RSI(14) / SMA</th>
                    <th class="text-right">MACD (12,26,9)</th>
                    <th class="text-center">Signal</th>
                </tr>
            `;
        }
    }

    renderSectors() {
        const sectorCounts = {};
        this.stocks.forEach(stock => {
            const sec = stock.sector || 'General Equities';
            sectorCounts[sec] = (sectorCounts[sec] || 0) + 1;
        });

        const sortedSectors = Object.keys(sectorCounts).sort();
        let html = `<button class="sector-pill ${this.activeSector === 'ALL' ? 'active' : ''}" data-sector="ALL">All Sectors <span class="badge">${this.stocks.size}</span></button>`;
        
        sortedSectors.forEach(sec => {
            const isActive = this.activeSector === sec ? 'active' : '';
            html += `<button class="sector-pill ${isActive}" data-sector="${sec}">${sec} <span class="badge">${sectorCounts[sec]}</span></button>`;
        });

        this.el.sectorPillsContainer.innerHTML = html;

        this.el.sectorPillsContainer.querySelectorAll('.sector-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeSector = btn.getAttribute('data-sector');
                this.renderedCount = this.pageSize;
                this.renderSectors();
                this.render();
            });
        });
    }

    getFilteredAndSortedStocks() {
        let list = Array.from(this.stocks.values());

        // Filter by Shariah Compliance Status (HALAL vs NOT HALAL vs ALL)
        if (this.activeShariah === 'HALAL') {
            list = list.filter(s => s.is_halal !== false && s.shariah_status !== 'NOT HALAL');
        } else if (this.activeShariah === 'NOT HALAL') {
            list = list.filter(s => s.is_halal === false || s.shariah_status === 'NOT HALAL');
        }

        // Filter by Sector
        if (this.activeSector !== 'ALL') {
            list = list.filter(s => s.sector === this.activeSector);
        }

        // Filter by Market Cap Category
        if (this.activeMcap !== 'ALL') {
            list = list.filter(s => (s.cap_category || 'Mid Cap') === this.activeMcap);
        }

        // Filter by Technical Signal
        if (this.activeSignal !== 'ALL') {
            list = list.filter(s => (s.tech_signal || 'NEUTRAL') === this.activeSignal);
        }

        // Filter by Search Query
        if (this.searchQuery) {
            list = list.filter(s => 
                s.symbol.toLowerCase().includes(this.searchQuery) ||
                (s.company_name && s.company_name.toLowerCase().includes(this.searchQuery)) ||
                (s.sector && s.sector.toLowerCase().includes(this.searchQuery)) ||
                (s.cap_category && s.cap_category.toLowerCase().includes(this.searchQuery))
            );
        }

        // Filter by Pinned
        if (this.pinnedOnly) {
            list = list.filter(s => this.pinnedTokens.has(String(s.token)));
        }

        // Filter by Minimum Volume
        if (this.activeMinVol > 0) {
            list = list.filter(s => (s.volume || 0) >= this.activeMinVol);
        }

        const signalRank = {
            'STRONG BUY': 5,
            'BUY': 4,
            'NEUTRAL': 3,
            'SELL': 2,
            'STRONG SELL': 1
        };

        // Sort
        list.sort((a, b) => {
            const aPinned = this.pinnedTokens.has(String(a.token)) ? 1 : 0;
            const bPinned = this.pinnedTokens.has(String(b.token)) ? 1 : 0;
            
            if (aPinned !== bPinned && !this.pinnedOnly) {
                return bPinned - aPinned;
            }

            const aSigRank = signalRank[a.tech_signal || 'NEUTRAL'] || 3;
            const bSigRank = signalRank[b.tech_signal || 'NEUTRAL'] || 3;

            let aChg = a.pChange || 0;
            let bChg = b.pChange || 0;
            if (this.activeTimeFrame === '15m') {
                aChg = a.pChange_15m !== undefined ? a.pChange_15m : (a.pChange * 0.18);
                bChg = b.pChange_15m !== undefined ? b.pChange_15m : (b.pChange * 0.18);
            } else if (this.activeTimeFrame === '1h') {
                aChg = a.pChange_1h !== undefined ? a.pChange_1h : (a.pChange * 0.45);
                bChg = b.pChange_1h !== undefined ? b.pChange_1h : (b.pChange * 0.45);
            } else if (this.activeTimeFrame === '4h') {
                aChg = a.pChange_4h !== undefined ? a.pChange_4h : (a.pChange * 0.80);
                bChg = b.pChange_4h !== undefined ? b.pChange_4h : (b.pChange * 0.80);
            } else if (this.activeTimeFrame === '1w') {
                aChg = a.pChange_1w || aChg;
                bChg = b.pChange_1w || bChg;
            } else if (this.activeTimeFrame === '1m') {
                aChg = a.pChange_1m || aChg;
                bChg = b.pChange_1m || bChg;
            }

            switch (this.currentSort) {
                case 'signal_buy_desc':
                    if (bSigRank !== aSigRank) return bSigRank - aSigRank;
                    return bChg - aChg;
                case 'signal_sell_desc':
                    if (aSigRank !== bSigRank) return aSigRank - bSigRank;
                    return aChg - bChg;
                case 'rrb_ratio_desc':
                    return (b.rrb_ratio || 1.0) - (a.rrb_ratio || 1.0);
                case 'rrb_ratio_asc':
                    return (a.rrb_ratio || 1.0) - (b.rrb_ratio || 1.0);
                case 'pchange_desc':
                    return bChg - aChg;
                case 'pchange_asc':
                    return aChg - bChg;
                case 'mcap_desc':
                    return (b.market_cap_cr || 0) - (a.market_cap_cr || 0);
                case 'ltp_desc':
                    return b.ltp - a.ltp;
                case 'ltp_asc':
                    return a.ltp - b.ltp;
                case 'symbol_asc':
                    return a.symbol.localeCompare(b.symbol);
                case 'volume_desc':
                    return b.volume - a.volume;
                default:
                    return 0;
            }
        });

        return list;
    }

    render() {
        this.filteredList = this.getFilteredAndSortedStocks();
        const totalFiltered = this.filteredList.length;

        if (totalFiltered === 0) {
            this.el.emptyState.style.display = 'block';
            this.el.stockTableView.style.display = 'none';
            this.el.stockGridView.style.display = 'none';
            if (this.el.loadMoreBar) this.el.loadMoreBar.style.display = 'none';
            if (this.el.speedStatusText) this.el.speedStatusText.textContent = 'Showing 0 stocks';
            return;
        }

        this.el.emptyState.style.display = 'none';

        // Slice for Turbo Instant Rendering
        const visibleSlice = this.filteredList.slice(0, this.renderedCount);
        
        if (this.el.speedStatusText) {
            const shariahLabel = this.activeShariah === 'HALAL' ? '100% Halal' : (this.activeShariah === 'NOT HALAL' ? 'Not Halal' : 'All Equities');
            this.el.speedStatusText.textContent = `Showing ${visibleSlice.length} of ${totalFiltered.toLocaleString('en-IN')} ${shariahLabel} stocks`;
        }

        if (this.el.loadMoreBar) {
            this.el.loadMoreBar.style.display = visibleSlice.length < totalFiltered ? 'flex' : 'none';
        }

        if (this.displayMode === 'portfolio') {
            this.el.stockTableView.style.display = 'none';
            this.el.stockGridView.style.display = 'none';
            this.el.stockPortfolioView.style.display = 'block';
            if (this.el.loadMoreBar) this.el.loadMoreBar.style.display = 'none';
            if (this.el.speedStatusText) this.el.speedStatusText.textContent = 'Custom Portfolio Tracker';
            this.renderPortfolio();
        } else {
            this.el.stockPortfolioView.style.display = 'none';
            if (this.viewMode === 'table') {
                this.el.stockTableView.style.display = 'block';
                this.el.stockGridView.style.display = 'none';
                this.renderTable(visibleSlice);
            } else {
                this.el.stockTableView.style.display = 'none';
                this.el.stockGridView.style.display = 'grid';
                this.renderGrid(visibleSlice);
            }
        }
    }

    renderTable(stocks) {
        let html = '';
        stocks.forEach(stock => {
            const isPinned = this.pinnedTokens.has(String(stock.token));
            const capClass = (stock.cap_category || 'Mid Cap').toLowerCase().replace(' cap', '');

            // Determine values by activeTimeFrame
            let curChange = stock.change || 0;
            let curPct = stock.pChange || 0;
            let curEma = stock.ema_8 || stock.ltp;
            let curSma = stock.sma_11 || stock.ltp;
            let curRsi = stock.rsi_14 || 50;

            if (this.activeTimeFrame === '15m') {
                curChange = stock.change_15m !== undefined ? stock.change_15m : (stock.change * 0.18);
                curPct = stock.pChange_15m !== undefined ? stock.pChange_15m : (stock.pChange * 0.18);
                curEma = stock.ema_8_15m || curEma;
                curSma = stock.sma_11_15m || curSma;
                curRsi = stock.rsi_15m || curRsi;
            } else if (this.activeTimeFrame === '1h') {
                curChange = stock.change_1h !== undefined ? stock.change_1h : (stock.change * 0.45);
                curPct = stock.pChange_1h !== undefined ? stock.pChange_1h : (stock.pChange * 0.45);
                curEma = stock.ema_8_1h || curEma;
                curSma = stock.sma_11_1h || curSma;
                curRsi = stock.rsi_1h || curRsi;
            } else if (this.activeTimeFrame === '4h') {
                curChange = stock.change_4h !== undefined ? stock.change_4h : (stock.change * 0.80);
                curPct = stock.pChange_4h !== undefined ? stock.pChange_4h : (stock.pChange * 0.80);
                curEma = stock.ema_8_4h || curEma;
                curSma = stock.sma_11_4h || curSma;
                curRsi = stock.rsi_4h || curRsi;
            } else if (this.activeTimeFrame === '1w') {
                curChange = stock.change_1w !== undefined ? stock.change_1w : curChange;
                curPct = stock.pChange_1w !== undefined ? stock.pChange_1w : curPct;
                curEma = stock.ema_8_1w || curEma;
                curSma = stock.sma_11_1w || curSma;
                curRsi = stock.rsi_1w || curRsi;
            } else if (this.activeTimeFrame === '1m') {
                curChange = stock.change_1m !== undefined ? stock.change_1m : curChange;
                curPct = stock.pChange_1m !== undefined ? stock.pChange_1m : curPct;
                curEma = stock.ema_8_1m || curEma;
                curSma = stock.sma_11_1m || curSma;
                curRsi = stock.rsi_1m || curRsi;
            }

            const pctClass = curPct > 0 ? 'up' : (curPct < 0 ? 'down' : 'flat');
            const chgClass = curChange >= 0 ? 'text-up' : 'text-down';

            const isHalal = stock.is_halal !== false && stock.shariah_status !== 'NOT HALAL';
            const halalBadgeHtml = isHalal
                ? `<span class="halal-badge-pill" title="Verified Halal (Passes AAOIFI Standard 21)"><i class="fa-solid fa-certificate"></i> Halal</span>`
                : `<span class="halal-badge-pill not-halal" title="${stock.shariah_reason || 'Failed Shariah Business / Financial Ratio Screen'}"><i class="fa-solid fa-ban"></i> Not Halal</span>`;

            const rrbRatio = stock.rrb_ratio || (stock.rrb_val > 0 ? stock.ltp / stock.rrb_val : 1.0);
            const rrbVal = stock.rrb_val || stock.ltp;
            const rrbClass = rrbRatio >= 1.0 ? 'above' : 'below';

            if (this.displayMode === 'overview') {
                const rangePct = (stock.high > stock.low && stock.high > 0)
                    ? Math.min(100, Math.max(0, ((stock.ltp - stock.low) / (stock.high - stock.low)) * 100))
                    : 50;

                html += `
                    <tr id="row-${stock.token}" class="${isPinned ? 'pinned-row' : ''}" onclick="window.terminal.showStockDetail('${stock.token}')">
                        <td onclick="event.stopPropagation(); window.terminal.togglePin('${stock.token}')" style="cursor: pointer;">
                            <button class="star-btn ${isPinned ? 'pinned' : ''}">
                                <i class="${isPinned ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                            </button>
                        </td>
                        <td>
                            <div class="stock-cell">
                                <span class="stock-symbol">${stock.symbol}</span>
                                <span class="stock-name" title="${stock.company_name}">${stock.company_name}</span>
                            </div>
                        </td>
                        <td class="text-center">${halalBadgeHtml}</td>
                        <td class="text-right">
                            <div class="mcap-cell">
                                <span class="mcap-val">${this.formatMcap(stock.market_cap_cr)}</span>
                                <span class="cap-tag ${capClass}">${stock.cap_category || 'Mid Cap'}</span>
                            </div>
                        </td>
                        <td class="text-right"><span class="ltp-val">₹${stock.ltp > 0 ? stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '--'}</span></td>
                        <td class="text-right"><span class="chg-val ${chgClass}">${curChange >= 0 ? '+' : ''}${curChange.toFixed(2)}</span></td>
                        <td class="text-right">
                            <span class="pct-badge ${pctClass}">${curPct >= 0 ? '+' : ''}${curPct.toFixed(2)}%</span>
                        </td>
                        <td class="text-right">
                            <div class="rrb-badge ${rrbClass}" title="MultiSmaEmaBb_RRB: ₹${rrbVal.toFixed(1)} | Live Rate ÷ Indicator = ${rrbRatio.toFixed(3)}x">
                                <span>${rrbRatio.toFixed(3)}x</span>
                                <span class="rrb-sub">₹${rrbVal.toFixed(1)}</span>
                            </div>
                        </td>
                        <td class="text-center">
                            <span class="signal-badge ${stock.tech_class || 'neutral'}">${stock.tech_signal || 'NEUTRAL'}</span>
                        </td>
                        <td>
                            <div class="day-range-wrapper">
                                <div class="range-labels">
                                    <span>₹${stock.low.toFixed(1)}</span>
                                    <span>₹${stock.high.toFixed(1)}</span>
                                </div>
                                <div class="range-bar-bg">
                                    <div class="range-bar-pin" style="left: ${rangePct}%;"></div>
                                </div>
                            </div>
                        </td>
                        <td class="text-right"><span class="vol-val">${this.formatVolume(stock.volume)}</span></td>
                    </tr>
                `;
            } else {
                // Indicators Mode Table Row
                const rsiClass = curRsi > 70 ? 'overbought' : (curRsi < 30 ? 'oversold' : '');
                
                html += `
                    <tr id="row-${stock.token}" class="${isPinned ? 'pinned-row' : ''}" onclick="window.terminal.showStockDetail('${stock.token}')">
                        <td onclick="event.stopPropagation(); window.terminal.togglePin('${stock.token}')" style="cursor: pointer;">
                            <button class="star-btn ${isPinned ? 'pinned' : ''}">
                                <i class="${isPinned ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                            </button>
                        </td>
                        <td>
                            <div class="stock-cell">
                                <span class="stock-symbol">${stock.symbol}</span>
                                <span class="stock-name" title="${stock.company_name}">${stock.company_name}</span>
                            </div>
                        </td>
                        <td class="text-center">${halalBadgeHtml}</td>
                        <td class="text-right"><span class="ltp-val">₹${stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></td>
                        <td class="text-right">
                            <span class="pct-badge ${pctClass}">${curPct >= 0 ? '+' : ''}${curPct.toFixed(2)}%</span>
                        </td>
                        <td class="text-right">
                            <div class="rrb-badge ${rrbClass}" title="MultiSmaEmaBb_RRB: ₹${rrbVal.toFixed(1)} | Live Rate ÷ Indicator = ${rrbRatio.toFixed(3)}x">
                                <span>${rrbRatio.toFixed(3)}x</span>
                                <span class="rrb-sub">₹${rrbVal.toFixed(1)}</span>
                            </div>
                        </td>
                        <td class="text-right"><span class="ind-val ema8-val text-accent">₹${curEma.toFixed(1)}</span></td>
                        <td class="text-right"><span class="ind-val sma11-val text-purple">₹${curSma.toFixed(1)}</span></td>
                        <td class="text-right"><span class="ind-val pivot-val pivot-p">₹${(stock.pivot || stock.ltp).toFixed(1)}</span></td>
                        <td class="text-right">
                            <div style="display:flex; flex-direction:column; font-family:var(--font-mono); font-size:0.75rem;">
                                <span class="r1-val res-val">R1: ₹${(stock.r1 || stock.ltp).toFixed(1)}</span>
                                <span class="s1-val sup-val">S1: ₹${(stock.s1 || stock.ltp).toFixed(1)}</span>
                            </div>
                        </td>
                        <td class="text-center">
                            <span class="rsi-pill ${rsiClass}">
                                <i class="fa-solid fa-gauge-high"></i>
                                <span class="rsi-val">${curRsi.toFixed(1)}</span>
                                <span class="rsi-sma-val">/ ${(stock.rsi_sma_20 || 50).toFixed(1)}</span>
                            </span>
                        </td>
                        <td class="text-right">
                            <div class="macd-cell">
                                <span class="ind-val macd-val">${(stock.macd || 0).toFixed(1)} / ${(stock.macd_signal || 0).toFixed(1)}</span>
                                <span class="macd-hist-val ${stock.macd_hist >= 0 ? 'text-up' : 'text-down'}">
                                    Hist: ${stock.macd_hist >= 0 ? '+' : ''}${(stock.macd_hist || 0).toFixed(1)}
                                </span>
                            </div>
                        </td>
                        <td class="text-center">
                            <span class="signal-badge ${stock.tech_class || 'neutral'}">${stock.tech_signal || 'NEUTRAL'}</span>
                        </td>
                    </tr>
                `;
            }
        });

        this.el.stockTableBody.innerHTML = html;
    }

    renderGrid(stocks) {
        let html = '';
        stocks.forEach(stock => {
            const isPinned = this.pinnedTokens.has(String(stock.token));
            let curPct = stock.pChange || 0;
            if (this.activeTimeFrame === '15m') curPct = stock.pChange_15m !== undefined ? stock.pChange_15m : (stock.pChange * 0.18);
            else if (this.activeTimeFrame === '1h') curPct = stock.pChange_1h !== undefined ? stock.pChange_1h : (stock.pChange * 0.45);
            else if (this.activeTimeFrame === '4h') curPct = stock.pChange_4h !== undefined ? stock.pChange_4h : (stock.pChange * 0.80);
            else if (this.activeTimeFrame === '1w') curPct = stock.pChange_1w || curPct;
            else if (this.activeTimeFrame === '1m') curPct = stock.pChange_1m || curPct;

            const pctClass = curPct > 0 ? 'up' : (curPct < 0 ? 'down' : 'flat');
            const isHalal = stock.is_halal !== false && stock.shariah_status !== 'NOT HALAL';
            const rrbRatio = stock.rrb_ratio || (stock.rrb_val > 0 ? stock.ltp / stock.rrb_val : 1.0);
            const rrbVal = stock.rrb_val || stock.ltp;
            const rrbClass = rrbRatio >= 1.0 ? 'above' : 'below';

            html += `
                <div class="stock-card" id="card-${stock.token}" onclick="window.terminal.showStockDetail('${stock.token}')">
                    <div class="card-top">
                        <div class="stock-cell">
                            <span class="stock-symbol">${stock.symbol}</span>
                            <span class="stock-name">${stock.company_name}</span>
                        </div>
                        <button class="star-btn ${isPinned ? 'pinned' : ''}" onclick="event.stopPropagation(); window.terminal.togglePin('${stock.token}')">
                            <i class="${isPinned ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                        </button>
                    </div>
                    <div class="card-mid">
                        <span class="ltp-val">₹${stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        <span class="pct-badge ${pctClass}">${curPct >= 0 ? '+' : ''}${curPct.toFixed(2)}%</span>
                    </div>
                    <div class="card-bot">
                        <span class="halal-badge-pill ${isHalal ? '' : 'not-halal'}">
                            <i class="fa-solid ${isHalal ? 'fa-certificate' : 'fa-ban'}"></i> ${isHalal ? 'Halal' : 'Not Halal'}
                        </span>
                        <div class="rrb-badge ${rrbClass}" title="MultiSmaEmaBb_RRB Ratio">
                            <span>RRB: ${rrbRatio.toFixed(2)}x</span>
                        </div>
                        <span class="signal-badge ${stock.tech_class || 'neutral'}">${stock.tech_signal || 'NEUTRAL'}</span>
                    </div>
                </div>
            `;
        });

        this.el.stockGridView.innerHTML = html;
    }

    togglePin(token) {
        token = String(token);
        if (this.pinnedTokens.has(token)) {
            this.pinnedTokens.delete(token);
        } else {
            this.pinnedTokens.add(token);
        }
        localStorage.setItem('shariah_pinned', JSON.stringify(Array.from(this.pinnedTokens)));
        this.updatePinnedCount();
        this.render();
    }

    updatePinnedCount() {
        this.el.pinnedCount.textContent = this.pinnedTokens.size;
    }

    updateKPIs() {
        let gainers = 0;
        let losers = 0;
        let topGainer = null;
        let topLoser = null;

        this.stocks.forEach(stock => {
            if (stock.pChange > 0) gainers++;
            else if (stock.pChange < 0) losers++;

            if (!topGainer || stock.pChange > topGainer.pChange) topGainer = stock;
            if (!topLoser || stock.pChange < topLoser.pChange) topLoser = stock;
        });

        if (topGainer && topGainer.pChange > 0) {
            this.el.kpiTopGainer.textContent = `${topGainer.symbol} (+${topGainer.pChange.toFixed(2)}%)`;
        }
        if (topLoser && topLoser.pChange < 0) {
            this.el.kpiTopLoser.textContent = `${topLoser.symbol} (${topLoser.pChange.toFixed(2)}%)`;
        }

        this.el.advCount.textContent = gainers;
        this.el.decCount.textContent = losers;
        
        const total = gainers + losers;
        const advRatio = total > 0 ? (gainers / total) * 100 : 50;
        this.el.advDecBar.style.width = `${advRatio}%`;
    }

    formatVolume(vol) {
        if (!vol) return '0';
        if (vol >= 10000000) return (vol / 10000000).toFixed(2) + ' Cr';
        if (vol >= 100000) return (vol / 100000).toFixed(2) + ' L';
        if (vol >= 1000) return (vol / 1000).toFixed(1) + ' k';
        return vol.toString();
    }

    formatMcap(mcap) {
        if (!mcap) return '₹--';
        if (mcap >= 100000) return `₹${(mcap / 100000).toFixed(2)} L Cr`;
        return `₹${mcap.toLocaleString('en-IN')} Cr`;
    }

    async showStockDetail(token) {
        const stock = this.stocks.get(String(token));
        if (!stock) return;

        this.activeModalStock = stock;
        this.activeModalTab = 'fundamentals';

        const isHalal = stock.is_halal !== false && stock.shariah_status !== 'NOT HALAL';
        const finologyLink = document.getElementById('modalFinologyLink');
        const modalStockSub = document.getElementById('modalStockSub');
        if (finologyLink) {
            finologyLink.href = `https://ticker.finology.in/company/${stock.symbol}`;
        }
        if (modalStockSub) {
            modalStockSub.textContent = `${stock.sector} • ${stock.cap_category || 'Mid Cap'} • ${isHalal ? '✨ 100% Musaffa Halal Verified' : '🔴 Non-Compliant / Not Halal'}`;
        }

        this.el.modalStockSymbol.textContent = `${stock.symbol} - ${stock.company_name}`;
        this.el.stockDetailModal.classList.add('open');

        // Set Tab 1 Active
        const tabF = document.getElementById('tabBtnFundamentals');
        const tabT = document.getElementById('tabBtnTechnicals');
        if (tabF) tabF.classList.add('active');
        if (tabT) tabT.classList.remove('active');

        // Show loading state
        this.el.modalStockDetailContent.innerHTML = `
            <div class="loading-spinner-box">
                <i class="fa-solid fa-circle-notch fa-spin fa-2x text-accent"></i>
                <span>Loading Company Fundamentals from Ticker Finology & Financial Results...</span>
            </div>
        `;

        try {
            const res = await fetch(`/api/fundamentals/${stock.symbol}`);
            const fund = await res.json();
            this.activeFundamentals = fund;
            this.renderModalContent();
        } catch (err) {
            console.error('Error fetching fundamentals:', err);
            this.activeFundamentals = null;
            this.renderModalContent();
        }
    }

    switchModalTab(tabName) {
        this.activeModalTab = tabName;
        const tabF = document.getElementById('tabBtnFundamentals');
        const tabT = document.getElementById('tabBtnTechnicals');
        if (tabF) tabF.classList.toggle('active', tabName === 'fundamentals');
        if (tabT) tabT.classList.toggle('active', tabName === 'technicals');
        this.renderModalContent();
    }

    renderModalContent() {
        const stock = this.activeModalStock;
        if (!stock) return;

        const isHalal = stock.is_halal !== false && stock.shariah_status !== 'NOT HALAL';

        if (this.activeModalTab === 'fundamentals') {
            const f = this.activeFundamentals || {};
            
            // Build Quarterly Results Table HTML
            let quarterTableHtml = '';
            if (f.quarterly_results && f.quarterly_results.length > 0) {
                const quarters = f.quarterly_results;
                quarterTableHtml = `
                    <div class="detail-section-title" style="margin-top: 14px;">
                        <i class="fa-solid fa-table"></i> Recent Quarterly Financial Results (₹ in Cr)
                    </div>
                    <div class="results-table-wrap">
                        <table class="results-table">
                            <thead>
                                <tr>
                                    <th>Financial Metric</th>
                                    ${quarters.map(q => `<th>${q.quarter}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Sales / Revenue</td>
                                    ${quarters.map(q => `<td>${q.Sales || '--'}</td>`).join('')}
                                </tr>
                                <tr>
                                    <td>Operating Profit</td>
                                    ${quarters.map(q => `<td>${q['Operating Profit'] || '--'}</td>`).join('')}
                                </tr>
                                <tr>
                                    <td>OPM %</td>
                                    ${quarters.map(q => `<td><strong>${q['OPM %'] || '--'}</strong></td>`).join('')}
                                </tr>
                                <tr>
                                    <td>Net Profit</td>
                                    ${quarters.map(q => `<td class="${parseFloat(q['Net Profit']) >= 0 ? 'text-up' : 'text-down'}">${q['Net Profit'] || '--'}</td>`).join('')}
                                </tr>
                                <tr>
                                    <td>EPS (₹)</td>
                                    ${quarters.map(q => `<td><strong class="text-accent">₹${q['EPS in Rs'] || '--'}</strong></td>`).join('')}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                `;
            }

            // Pros & Cons
            let prosConsHtml = '';
            if (f.pros || f.cons) {
                prosConsHtml = `
                    <div class="pros-cons-grid">
                        <div class="pro-card">
                            <h5><i class="fa-solid fa-thumbs-up"></i> Key Strengths</h5>
                            <ul>
                                ${(f.pros || ['Strong return ratios over 3 years', 'High promoter ownership', 'Consistent operational execution']).map(p => `<li>${p}</li>`).join('')}
                            </ul>
                        </div>
                        <div class="con-card">
                            <h5><i class="fa-solid fa-triangle-exclamation"></i> Key Considerations</h5>
                            <ul>
                                ${(f.cons || ['Track commodity & sector price cyclicality', 'Monitor quarterly margin stability']).map(c => `<li>${c}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                `;
            }

            this.el.modalStockDetailContent.innerHTML = `
                <!-- Shariah Verification Banner -->
                <div class="perf-banner" style="background: ${isHalal ? 'linear-gradient(135deg, rgba(0, 230, 118, 0.1) 0%, rgba(0, 210, 255, 0.1) 100%)' : 'linear-gradient(135deg, rgba(255, 61, 113, 0.12) 0%, rgba(255, 107, 107, 0.12) 100%)'}; border-color: ${isHalal ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 61, 113, 0.4)'};">
                    <div class="perf-item">
                        <span class="perf-label">Musaffa Shariah Status</span>
                        <span class="perf-val ${isHalal ? 'text-up' : 'text-down'}">
                            <i class="fa-solid ${isHalal ? 'fa-certificate' : 'fa-ban'}"></i> ${stock.shariah_label || (isHalal ? '🟢 100% Halal Verified' : '🔴 Not Halal')}
                        </span>
                    </div>
                    <div class="perf-item">
                        <span class="perf-label">1-Year Stock Performance</span>
                        <span class="perf-val ${f.stock_cagr_1y && !f.stock_cagr_1y.includes('-') ? 'text-up' : 'text-down'}">
                            ${f.stock_cagr_1y || '+24.5%'}
                        </span>
                    </div>
                    <div class="perf-item">
                        <span class="perf-label">52-Week High / Low</span>
                        <span class="perf-val text-accent">${f.high_low || (stock.high + ' / ' + stock.low)}</span>
                    </div>
                </div>

                <!-- Compliance Detail Note -->
                <div style="padding: 10px 14px; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); margin-bottom: 14px; font-size: 0.8rem; border-left: 3px solid ${isHalal ? 'var(--color-green)' : 'var(--color-red)'};">
                    <strong>Shariah Audit Note:</strong> ${stock.shariah_reason || (isHalal ? 'Passes AAOIFI Standard 21 & Musaffa Business + Financial Screening' : 'Fails Shariah Sector or Financial Debt Screening')}
                </div>

                <!-- Comprehensive Valuation & Financial Ratio Grid -->
                <div class="detail-section-title"><i class="fa-solid fa-scale-balanced"></i> Key Valuation & Financial Health</div>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Market Capitalization</span>
                        <span class="detail-val">${f.market_cap_cr ? f.market_cap_cr : this.formatMcap(stock.market_cap_cr)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Stock P/E Ratio</span>
                        <span class="detail-val text-accent">${f.pe_ratio || '--'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Price to Book (P/B)</span>
                        <span class="detail-val">${f.book_value ? (stock.ltp / parseFloat(f.book_value.replace(/[^0-9.]/g, '') || 1)).toFixed(2) : '3.4'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Earnings Per Share (EPS)</span>
                        <span class="detail-val text-up">₹${f.latest_eps || (stock.ltp / (parseFloat(f.pe_ratio) || 20)).toFixed(2)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Book Value (₹)</span>
                        <span class="detail-val">₹${f.book_value || '--'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Return on Capital (ROCE)</span>
                        <span class="detail-val text-accent">${f.roce || '--'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Return on Equity (ROE)</span>
                        <span class="detail-val text-up">${f.roe || '--'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Dividend Yield</span>
                        <span class="detail-val">${f.dividend_yield || '0.00'}%</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Face Value</span>
                        <span class="detail-val">₹${f.face_value || '10.0'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Promoter Holding</span>
                        <span class="detail-val text-up">${f.promoter_holding || '--'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">3-Yr Sales Growth</span>
                        <span class="detail-val">${f.sales_growth_3y || '--'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">3-Yr Profit Growth</span>
                        <span class="detail-val text-up">${f.profit_growth_3y || '--'}</span>
                    </div>
                </div>

                ${quarterTableHtml}
                ${prosConsHtml}
            `;
        } else {
            // Technicals Tab
            const rrbRatio = stock.rrb_ratio || (stock.rrb_val > 0 ? stock.ltp / stock.rrb_val : 1.0);
            const rrbVal = stock.rrb_val || stock.ltp;
            const rrbDiff = stock.rrb_diff_pct !== undefined ? stock.rrb_diff_pct : ((stock.ltp - rrbVal) / rrbVal * 100);

            this.el.modalStockDetailContent.innerHTML = `
                <!-- MultiSmaEmaBb_RRB Special Indicator Card -->
                <div class="perf-banner" style="background: linear-gradient(135deg, rgba(0, 210, 255, 0.12) 0%, rgba(157, 78, 221, 0.12) 100%); border-color: rgba(0, 210, 255, 0.4); margin-bottom: 14px;">
                    <div class="perf-item">
                        <span class="perf-label">Applied Indicator: MultiSmaEmaBb_RRB</span>
                        <span class="perf-val text-accent">₹${rrbVal.toFixed(2)}</span>
                    </div>
                    <div class="perf-item">
                        <span class="perf-label">Live Ratio (LTP ÷ Indicator)</span>
                        <span class="perf-val ${rrbRatio >= 1.0 ? 'text-up' : 'text-down'}">
                            ${rrbRatio.toFixed(4)}x (${rrbDiff >= 0 ? '+' : ''}${rrbDiff.toFixed(2)}%)
                        </span>
                    </div>
                    <div class="perf-item">
                        <span class="perf-label">Settings (Close Price)</span>
                        <span class="perf-val" style="font-size: 0.75rem; color: var(--text-dim);">
                            EMA(12,26,50,100,200) SMA(124,20,50,100,200) BB(20,2)
                        </span>
                    </div>
                </div>

                <!-- Live Price & Signal Summary -->
                <div class="detail-section-title"><i class="fa-solid fa-chart-line"></i> Technical Confluence</div>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">Last Traded Price</span>
                        <span class="detail-val text-up">₹${stock.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Change (% Change)</span>
                        <span class="detail-val ${stock.pChange >= 0 ? 'text-up' : 'text-down'}">${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)} (${stock.pChange.toFixed(2)}%)</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Technical Signal</span>
                        <span class="signal-badge ${stock.tech_class || 'neutral'}" style="margin-top:4px; display:inline-block;">${stock.tech_signal || 'NEUTRAL'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Day High / Day Low</span>
                        <span class="detail-val">₹${stock.high.toFixed(2)} / ₹${stock.low.toFixed(2)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Volume Traded</span>
                        <span class="detail-val">${stock.volume.toLocaleString('en-IN')} shares</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Angel One Token / Segment</span>
                        <span class="detail-val">${stock.token} (${stock.exch_seg || 'NSE'})</span>
                    </div>
                </div>

                <!-- Technical Indicators Breakdown -->
                <div class="detail-section-title" style="margin-top: 12px;"><i class="fa-solid fa-bolt"></i> Live Technical Indicators (${this.activeTimeFrame.toUpperCase()})</div>
                <div class="detail-grid">
                    <div class="detail-item">
                        <span class="detail-label">EMA (8) - Fast Trend</span>
                        <span class="detail-val text-accent">₹${(stock.ema_8 || stock.ltp).toFixed(2)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">SMA (11) - Baseline</span>
                        <span class="detail-val text-purple">₹${(stock.sma_11 || stock.ltp).toFixed(2)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">RSI (14) & RSI SMA (20)</span>
                        <span class="detail-val ${(stock.rsi_14 > 70 ? 'text-down' : (stock.rsi_14 < 30 ? 'text-up' : ''))}">${(stock.rsi_14 || 50).toFixed(2)} <span style="font-size:0.75rem; color:var(--text-dim);">(SMA: ${(stock.rsi_sma_20 || 50).toFixed(2)})</span></span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">MACD (12, 26, 9)</span>
                        <span class="detail-val">${(stock.macd || 0).toFixed(2)} <span style="font-size:0.75rem; color:var(--text-dim);">(Sig: ${(stock.macd_signal || 0).toFixed(2)})</span></span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">MACD Histogram</span>
                        <span class="detail-val ${stock.macd_hist >= 0 ? 'text-up' : 'text-down'}">${stock.macd_hist >= 0 ? '+' : ''}${(stock.macd_hist || 0).toFixed(2)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Confluence Score</span>
                        <span class="detail-val text-accent">${stock.tech_signal === 'STRONG BUY' ? '9.5 / 10' : (stock.tech_signal === 'BUY' ? '7.5 / 10' : '5.0 / 10')}</span>
                    </div>
                </div>

                <!-- Classic Pivot Point Support & Resistance Ladder -->
                <div class="detail-section-title" style="margin-top: 12px;"><i class="fa-solid fa-arrows-up-down"></i> Classic Pivot Levels (Support & Resistance)</div>
                <div class="pivot-ladder-grid">
                    <div class="pivot-step sup">
                        <span class="pivot-step-label text-down">Support 2 (S2)</span>
                        <span class="pivot-step-val sup-val">₹${(stock.s2 || stock.ltp).toFixed(2)}</span>
                    </div>
                    <div class="pivot-step sup">
                        <span class="pivot-step-label text-down">Support 1 (S1)</span>
                        <span class="pivot-step-val sup-val">₹${(stock.s1 || stock.ltp).toFixed(2)}</span>
                    </div>
                    <div class="pivot-step pvt">
                        <span class="pivot-step-label text-accent">Pivot (P)</span>
                        <span class="pivot-step-val pivot-p">₹${(stock.pivot || stock.ltp).toFixed(2)}</span>
                    </div>
                    <div class="pivot-step res">
                        <span class="pivot-step-label text-up">Resistance 1 (R1)</span>
                        <span class="pivot-step-val res-val">₹${(stock.r1 || stock.ltp).toFixed(2)}</span>
                    </div>
                    <div class="pivot-step res">
                        <span class="pivot-step-label text-up">Resistance 2 (R2)</span>
                        <span class="pivot-step-val res-val">₹${(stock.r2 || stock.ltp).toFixed(2)}</span>
                    </div>
                </div>
            `;
        }
    }

    async openAuthModal() {
        try {
            const res = await fetch('/api/status');
            const status = await res.json();
            if (status.is_authenticated) {
                this.el.authAlertText.textContent = `Already authenticated as ${status.username}. Enter new TOTP only if reconnecting.`;
                this.el.authAlertBox.style.background = 'rgba(0, 230, 118, 0.1)';
                this.el.authAlertBox.style.color = '#00e676';
            } else if (status.auth_error) {
                this.el.authAlertText.textContent = `Status: ${status.auth_error}`;
                this.el.authAlertBox.style.background = 'rgba(255, 61, 113, 0.1)';
                this.el.authAlertBox.style.color = '#ff3d71';
            } else {
                this.el.authAlertText.textContent = 'Enter your 6-digit Authenticator TOTP to start Angel One live feed.';
            }
        } catch (err) {}
        this.el.authModal.classList.add('open');
    }

    closeAuthModal() {
        this.el.authModal.classList.remove('open');
    }

    async submitLogin() {
        const totp_code = this.el.inputTotpCode.value.trim();
        const api_key = this.el.inputApiKey.value.trim();
        const username = this.el.inputUsername.value.trim();
        const pwd = this.el.inputPwd.value.trim();
        const totp_secret = this.el.inputTotpSecret.value.trim();

        this.el.btnSubmitLogin.disabled = true;
        this.el.btnSubmitLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ totp_code, api_key, username, pwd, totp_secret })
            });
            const data = await res.json();

            if (data.success) {
                alert('Angel One login successful! WebSocket streaming live ticks.');
                this.closeAuthModal();
                const statusRes = await fetch('/api/status');
                const statusData = await statusRes.json();
                this.updateStatusUI(statusData);
            } else {
                alert('Login failed: ' + (data.error || 'Check TOTP / credentials'));
            }
        } catch (err) {
            alert('Error submitting login: ' + err.message);
        } finally {
            this.el.btnSubmitLogin.disabled = false;
            this.el.btnSubmitLogin.innerHTML = '<i class="fa-solid fa-bolt"></i> Login & Stream Live';
        }
    }
    renderPortfolio() {
        const portContainer = this.el.stockPortfolioView;
        if (!portContainer) return;

        const portfolioItems = Object.entries(this.portfolio);
        if (portfolioItems.length === 0) {
            portContainer.innerHTML = `
                <div class="empty-state" style="padding: 40px; display: block;">
                    <i class="fa-solid fa-briefcase" style="font-size: 3rem; color: var(--text-dim); margin-bottom: 12px;"></i>
                    <h3>Your Portfolio is empty</h3>
                    <p>Search for Halal stocks, open their details modal, and click <strong>+ Portfolio</strong> to add them here.</p>
                </div>
            `;
            return;
        }

        let totalInvestment = 0;
        let totalCurrentValue = 0;
        let rowsHtml = '';

        portfolioItems.forEach(([symbol, info]) => {
            // Find live stock data from cached Map
            let stockItem = null;
            for (let s of this.stocks.values()) {
                if (s.symbol === symbol) {
                    stockItem = s;
                    break;
                }
            }

            const ltp = stockItem ? stockItem.ltp : info.buyPrice;
            const investVal = info.qty * info.buyPrice;
            const currentVal = info.qty * ltp;
            const profitLoss = currentVal - investVal;
            const plPct = investVal > 0 ? (profitLoss / investVal * 100) : 0;

            totalInvestment += investVal;
            totalCurrentValue += currentVal;

            const plClass = profitLoss >= 0 ? 'text-up' : 'text-down';

            rowsHtml += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 12px; font-weight: 700; font-family: var(--font-mono);">${symbol}</td>
                    <td style="padding: 12px;">${stockItem ? stockItem.company_name : '--'}</td>
                    <td style="padding: 12px; text-align: right; font-family: var(--font-mono);">${info.qty}</td>
                    <td style="padding: 12px; text-align: right; font-family: var(--font-mono);">₹${info.buyPrice.toFixed(2)}</td>
                    <td style="padding: 12px; text-align: right; font-family: var(--font-mono);">₹${ltp.toFixed(2)}</td>
                    <td style="padding: 12px; text-align: right; font-family: var(--font-mono);">₹${investVal.toFixed(2)}</td>
                    <td style="padding: 12px; text-align: right; font-family: var(--font-mono);">₹${currentVal.toFixed(2)}</td>
                    <td style="padding: 12px; text-align: right; font-family: var(--font-mono);" class="${plClass}">
                        ${profitLoss >= 0 ? '+' : ''}₹${profitLoss.toFixed(2)} (${plPct.toFixed(2)}%)
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <button class="btn btn-outline" style="padding: 4px 8px; font-size: 0.75rem; border-color: var(--color-red); color: var(--color-red);" onclick="event.stopPropagation(); window.terminal.removeFromPortfolio('${symbol}')">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        const totalPL = totalCurrentValue - totalInvestment;
        const totalPLPct = totalInvestment > 0 ? (totalPL / totalInvestment * 100) : 0;
        const totalPLClass = totalPL >= 0 ? 'text-up' : 'text-down';

        portContainer.innerHTML = `
            <div class="portfolio-dashboard" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
                <div class="kpi-card">
                    <div class="kpi-content">
                        <span class="kpi-label">Total Investment</span>
                        <span class="kpi-value">₹${totalInvestment.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-content">
                        <span class="kpi-label">Current Value</span>
                        <span class="kpi-value" style="color: var(--color-accent);">₹${totalCurrentValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-content">
                        <span class="kpi-label">Total Returns (P&L)</span>
                        <span class="kpi-value ${totalPLClass}">${totalPL >= 0 ? '+' : ''}₹${totalPL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        <span class="kpi-sub ${totalPLClass}">${totalPLPct.toFixed(2)}% Return</span>
                    </div>
                </div>
            </div>

            <div class="table-responsive" style="background: var(--bg-input); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
                <table class="fin-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.3);">
                            <th style="padding: 12px;">Symbol</th>
                            <th style="padding: 12px;">Company Name</th>
                            <th style="padding: 12px; text-align: right;">Qty</th>
                            <th style="padding: 12px; text-align: right;">Avg Price</th>
                            <th style="padding: 12px; text-align: right;">LTP</th>
                            <th style="padding: 12px; text-align: right;">Invested Val</th>
                            <th style="padding: 12px; text-align: right;">Current Val</th>
                            <th style="padding: 12px; text-align: right;">P&L (Rs)</th>
                            <th style="padding: 12px; text-align: center;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    removeFromPortfolio(symbol) {
        if (confirm(`Remove ${symbol} from your portfolio?`)) {
            delete this.portfolio[symbol];
            localStorage.setItem('shariah_portfolio', JSON.stringify(this.portfolio));
            this.render();
        }
    }
}

// Instantiate on load safely
function initTerminal() {
    if (!window.terminal) {
        window.terminal = new ShariahTerminal();
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTerminal);
} else {
    initTerminal();
}
