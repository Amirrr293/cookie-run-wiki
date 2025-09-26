/* global ColorThief, __app_id, __firebase_config, __initial_auth_token */
import { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// --- Helper function for CORS proxy ---
// A simple proxy to prevent cross-origin issues when fetching images from wikis.
const proxifyUrl = (url) => {
    if (!url || url.startsWith('data:') || !url.startsWith('http')) return url;
    return `https://corsproxy.io/?${encodeURIComponent(url)}`;
};

// --- Default Data (if the database is empty) ---
const defaultCookie = {
    id: 'default-cookie-1',
    name: 'GingerBrave',
    avatarUrl: 'https://static.wikia.nocookie.net/cookierunkingdom/images/b/b5/Cookie_gingerbrave_card.png/revision/latest',
    spriteUrl: 'https://static.wikia.nocookie.net/cookierunkingdom/images/c/c9/Cookie0001_run.gif/revision/latest',
    headIconUrl: 'https://static.wikia.nocookie.net/cookierunkingdom/images/e/e0/Cookie0001_head.png/revision/latest',
    rarity: 'Common',
    role: 'Charge',
    position: 'Front',
    skillName: 'Brave Dash',
    skillDescription: 'Charges forward, dealing damage to enemies in the way. A classic move of a brave cookie.',
    skillUrl: 'https://static.wikia.nocookie.net/cookierunkingdom/images/e/ef/SkillIcon_0001.png/revision/latest',
    elements: [],
    costumes: [],
    createdAt: new Date(0) // A very old date to ensure it sorts first
};

const defaultTiers = [
    { id: 'S', name: 'S', color: 'bg-red-500', cookieIds: [] },
    { id: 'A', name: 'A', color: 'bg-orange-500', cookieIds: [] },
    { id: 'B', name: 'B', color: 'bg-yellow-500', cookieIds: [] },
    { id: 'C', name: 'C', color: 'bg-green-500', cookieIds: [] },
];

const defaultPvpTierList = { id: 'pvp-tier-list', name: 'PvP Tier List', tiers: defaultTiers };
const defaultPveTierList = { id: 'pve-tier-list', name: 'PvE Tier List', tiers: defaultTiers };


// --- Custom Hook for Color Extraction from Header Image ---
const useImageColors = (imageUrl) => {
    const [colors, setColors] = useState(null);

    useEffect(() => {
        const extractColors = () => {
            if (!imageUrl || typeof ColorThief === 'undefined') return;

            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = proxifyUrl(imageUrl);
            const colorThief = new ColorThief();

            img.onload = () => {
                try {
                    const dominant = colorThief.getColor(img);
                    const palette = colorThief.getPalette(img, 8);

                    const formatRgb = (rgb) => `rgb(${rgb.join(',')})`;
                    const getContrastYIQ = (rgb) => ((rgb[0] * 299) + (rgb[1] * 587) + (rgb[2] * 114)) / 1000;

                    const primary = palette[1] || dominant;
                    const accent = palette[2] || primary;

                    setColors({
                        primary: formatRgb(primary),
                        accent: formatRgb(accent),
                        background: formatRgb(dominant),
                        text: getContrastYIQ(dominant) >= 128 ? 'rgb(0,0,0)' : 'rgb(255,255,255)',
                        highlight: formatRgb(palette[3] || [250, 204, 21]),
                    });
                } catch (error) {
                    console.error("ColorThief Error:", error);
                }
            };
            img.onerror = (error) => {
                 console.error("Image load error for color extraction:", error);
            }
        };

        // Poll until the ColorThief library is loaded
        const checkColorThief = () => {
            if (typeof ColorThief !== 'undefined') {
                extractColors();
            } else {
                setTimeout(checkColorThief, 100);
            }
        };
        checkColorThief();

    }, [imageUrl]);

    return colors;
};


// --- Helper & Icon Components ---
const Icon = ({ path, className = "w-6 h-6" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);

const SortArrow = ({ direction }) => (
  <Icon path={direction === 'asc' ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} className="w-4 h-4 ml-1" />
);

const SortButton = ({ option, text, currentSort, onSort }) => (
    <button onClick={() => onSort(option)} className={`flex items-center space-x-2 px-4 py-2 transition-all rounded-full ${currentSort.option === option ? 'bg-[var(--color-primary)] text-white' : 'text-white opacity-70 hover:opacity-100'}`}>
      <span>{text}</span>
      {currentSort.option === option && <SortArrow direction={currentSort.direction} />}
    </button>
);

const getRarityBorderClass = (rarityName) => ({
    'Common': 'border-gray-400', 'Rare': 'border-teal-400', 'Special': 'border-purple-500',
    'Epic': 'border-red-500', 'Super Epic': 'border-yellow-400', 'Legendary': 'border-yellow-500',
    'Dragon': 'border-red-600', 'Ancient': 'border-stone-400', 'Beast': 'border-slate-500'
}[rarityName] || 'border-gray-400');


// --- UI Components ---

const Sidebar = ({ currentView, isSidebarOpen, setView, setIsSidebarOpen }) => (
    <div className={`bg-slate-800 flex-shrink-0 h-screen sticky top-0 flex flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-64 p-6' : 'w-20 p-4'}`}>
      <div className="flex-grow space-y-4">
        <SidebarButton icon="M12 2l2.35 7.18h7.55l-6.1 4.44 2.35 7.18-6.1-4.44-6.1 4.44 2.35-7.18-6.1-4.44h7.55z" text="Manage Cookies" buttonView="list" currentView={currentView} isSidebarOpen={isSidebarOpen} onClick={() => setView('list')} />
        <SidebarButton icon="M9 3h6l2 2v5h2v11H5V10h2V5l2-2z" text="Manage Costumes" buttonView="costumes" currentView={currentView} isSidebarOpen={isSidebarOpen} onClick={() => setView('costumes')} />
        <SidebarButton icon="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" text="Manage Power-ups" buttonView="powerups" currentView={currentView} isSidebarOpen={isSidebarOpen} onClick={() => setView('powerups')} />
        <SidebarButton icon="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM3.75 14.25A2.25 2.25 0 016 12h2.25a2.25 2.25 0 012.25 2.25v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 14.25a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25v2.25a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" text="Tier List" buttonView="tierlist" currentView={currentView} isSidebarOpen={isSidebarOpen} onClick={() => setView('tierlist')} />
        <SidebarButton icon="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" text="Manage Attributes" buttonView="attributes" currentView={currentView} isSidebarOpen={isSidebarOpen} onClick={() => setView('attributes')} />
      </div>
      <div className="mt-auto">
        <SidebarButton icon={isSidebarOpen ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} text={isSidebarOpen ? "Collapse" : null} isSidebarOpen={isSidebarOpen} onClick={() => setIsSidebarOpen(!isSidebarOpen)} />
      </div>
    </div>
);

const SidebarButton = ({ icon, text, onClick, buttonView, currentView, isSidebarOpen }) => {
    const isActive = buttonView === currentView;
    const activeClass = isActive ? 'bg-[var(--color-primary)]' : 'bg-slate-700 hover:bg-slate-600';

    return (
        <button onClick={onClick} className={`w-full flex items-center p-3 text-white font-bold rounded-lg shadow-lg transition-colors ${activeClass} ${isSidebarOpen ? 'justify-start' : 'justify-center'}`}>
            <Icon path={icon} className="w-6 h-6 flex-shrink-0" />
            {isSidebarOpen && text && <span className="ml-4">{text}</span>}
        </button>
    );
};

const RaritySection = ({ rarityName, items, collapsedRarities, setCollapsedRarities, getAttributeImageUrl, onCardClick, itemType }) => {
    const isCollapsed = collapsedRarities[rarityName];

    return (
        <div>
            <div onClick={() => setCollapsedRarities(p => ({...p, [rarityName]: !p[rarityName]}))} className="flex justify-between items-center mb-6 cursor-pointer">
                <div className="flex items-center space-x-4">
                    <img src={proxifyUrl(getAttributeImageUrl(itemType === 'costume' ? 'costumeRarity' : 'rarity', rarityName))} alt={rarityName} className="w-10 h-10 object-contain" />
                    <h2 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">{rarityName}</h2>
                </div>
                <Icon path="M19 9l-7 7-7-7" className={`w-6 h-6 text-white transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`} />
            </div>
            {!isCollapsed && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-8">
                    {items.map((item) => {
                        if (itemType === 'cookie') {
                            return <CookieCard key={item.id} cookie={item} onCardClick={() => onCardClick(item)} getAttributeImageUrl={getAttributeImageUrl} />
                        }
                        if (itemType === 'costume') {
                            return <CostumeCard key={`${item.cookie.id}-${item.name}`} costume={item} onCardClick={() => onCardClick(item)} getAttributeImageUrl={getAttributeImageUrl} />
                        }
                        return null;
                    })}
                </div>
            )}
        </div>
    );
};

// --- Main Views ---

const CookieListView = ({ searchTerm, setSearchTerm, sort, onSort, groupedCookies, sortedCookies, collapsedRarities, setCollapsedRarities, getAttributeImageUrl, onCardClick }) => (
    <>
      <header className="mb-10 text-center">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg">Cookie Run: Kingdom Wiki</h1>
        <div className="flex flex-col md:flex-row justify-center items-center mt-6 gap-4">
            <div className="relative w-full md:w-auto">
                <input
                    type="text"
                    placeholder="Search for a cookie..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full md:w-64 bg-slate-800/70 text-white placeholder-white placeholder-opacity-60 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="w-5 h-5 text-white opacity-60" />
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white drop-shadow-sm">Sort:</span>
                <div className="flex items-center bg-slate-800/70 rounded-full shadow-lg p-1">
                    <SortButton option="rarity" text="Rarity" currentSort={sort} onSort={onSort} />
                    <div className="w-px h-5 bg-slate-600"></div>
                    <SortButton option="name" text="Name" currentSort={sort} onSort={onSort} />
                </div>
            </div>
        </div>
      </header>
      <div className="space-y-10">
        {sort.option === 'rarity' ? (
            Object.entries(groupedCookies).map(([rarityName, cookies]) => (
                <RaritySection
                    key={rarityName}
                    rarityName={rarityName}
                    items={cookies}
                    collapsedRarities={collapsedRarities}
                    setCollapsedRarities={setCollapsedRarities}
                    getAttributeImageUrl={getAttributeImageUrl}
                    onCardClick={(item) => onCardClick('detail', item)}
                    itemType="cookie"
                />
            ))
        ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-8">
                {sortedCookies.map(cookie => (
                    <CookieCard
                        key={cookie.id}
                        cookie={cookie}
                        onCardClick={() => onCardClick('detail', cookie)}
                        getAttributeImageUrl={getAttributeImageUrl}
                    />
                ))}
            </div>
        )}
      </div>
    </>
);

// --- Modals and Forms ---

const ModalWrapper = ({ children, onClose }) => {
    const modalRef = useRef(null);

    useEffect(() => {
        const handleKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleBackdropClick = (e) => {
        if (modalRef.current && !modalRef.current.contains(e.target)) {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-70" onClick={handleBackdropClick}>
            <div ref={modalRef}>{children}</div>
        </div>
    );
};

function ConfirmDialog({ message, onConfirm, onCancel }) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-80 flex justify-center items-center z-[60]">
        <div className="bg-slate-800 rounded-lg p-8 shadow-xl text-white max-w-sm mx-auto">
          <h3 className="text-lg font-bold mb-6 text-center">{message}</h3>
          <div className="flex justify-center space-x-4">
            <button onClick={onCancel} className="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-full transition-colors">Cancel</button>
            <button onClick={onConfirm} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full transition-colors">Confirm</button>
          </div>
        </div>
      </div>
    );
}

const DescriptionWithIcons = ({ text, cookies }) => {
    const parts = useMemo(() => {
        if (!text || !cookies || !cookies.length) return [text];
        const cookieNames = cookies.map(c => c.name).sort((a, b) => b.length - a.length);
        const regex = new RegExp(`\\b(${cookieNames.join('|')})('s|,)?\\b`, 'g');
        let lastIndex = 0; const result = [];
        text.replace(regex, (match, cookieName, punctuation = '', offset) => {
            if (offset > lastIndex) result.push(text.substring(lastIndex, offset));
            result.push({ name: cookieName, punctuation });
            lastIndex = offset + match.length;
        });
        if (lastIndex < text.length) result.push(text.substring(lastIndex));
        return result;
    }, [text, cookies]);

    return (
        <p className="mt-4 opacity-80 text-justify leading-relaxed">
            {parts.map((part, index) => {
                if (typeof part === 'object') {
                    const cookie = cookies.find(c => c.name === part.name);
                    if (cookie && cookie.headIconUrl) {
                        return (
                            <span key={index} className="inline-flex items-center align-middle mx-1">
                                <img src={proxifyUrl(cookie.headIconUrl)} alt={cookie.name} className="w-6 h-6 inline-block mr-1 object-contain" />
                                <span className="font-bold">{cookie.name}{part.punctuation}</span>
                            </span>
                        );
                    }
                }
                return <span key={index}>{part}</span>;
            })}
        </p>
    );
};

function CookieDetail({ cookie, allCookies, powerUp, cookieTiers, onClose, onEdit, onDelete, onCostumeClick, getAttributeImageUrl }) {
    const rarityBorderClass = getRarityBorderClass(cookie.rarity);

    return (
        <div className={`w-full max-w-5xl relative text-white rounded-2xl mb-8 max-h-[90vh] overflow-y-auto bg-slate-900/80 backdrop-blur-lg border-4 ${rarityBorderClass}`}>
          <div className="absolute top-4 right-4 flex items-center bg-slate-800/70 rounded-full shadow-lg z-10">
              <button onClick={() => onEdit(cookie)} className="p-3 text-[var(--color-primary)] hover:opacity-80 transition-colors" aria-label="Edit Cookie"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L7.582 19.82a2.25 2.25 0 01-1.06.58L3.75 21l.663-2.75a2.25 2.25 0 01.58-1.06l11.872-11.872zM15.75 5.25l2.25 2.25" className="w-5 h-5" /></button>
              <div className="w-px h-5 bg-slate-600"></div>
              <button onClick={() => onDelete(cookie.id)} className="p-3 text-red-400 hover:text-red-300 transition-colors" aria-label="Delete Cookie"><Icon path="M19 7l-.867 12.143A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.857L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" className="w-5 h-5" /></button>
              <div className="w-px h-5 bg-slate-600"></div>
              <button onClick={onClose} className="p-3 text-white opacity-70 hover:opacity-100 transition-colors" aria-label="Close"><Icon path="M6 18L18 6M6 6l12 12" className="w-5 h-5" /></button>
          </div>
          <div className="relative p-8 pt-20">
            <div className="flex flex-col items-center gap-6 mb-8">
              <img src={proxifyUrl(cookie.spriteUrl) || `https://placehold.co/300x300/cccccc/000000?text=Illustration`} alt={`${cookie.name} illustration`} className="w-80 h-80 object-contain" />
              <div className="flex-grow text-center">
                <h1 className="text-5xl font-extrabold tracking-wide text-shadow-lg mb-4">{cookie.name}</h1>
                <div className="flex flex-wrap justify-center items-center gap-2">
                  {cookieTiers?.pvp && <TierTag tier={cookieTiers.pvp} type="PvP" />}
                  {cookieTiers?.pve && <TierTag tier={cookieTiers.pve} type="PvE" />}
                  <DetailTag type="rarity" value={cookie.rarity} getAttributeImageUrl={getAttributeImageUrl} />
                  <DetailTag type="role" value={cookie.role} getAttributeImageUrl={getAttributeImageUrl} />
                  <DetailTag type="position" value={cookie.position} getAttributeImageUrl={getAttributeImageUrl} />
                  {(cookie.elements || []).map(el => <DetailTag key={el} type="element" value={el} getAttributeImageUrl={getAttributeImageUrl} />)}
                </div>
              </div>
            </div>
            <div className="space-y-8">
                <div className="bg-slate-800/50 p-6 rounded-2xl border-2 border-white/30">
                    <h2 className="text-2xl font-bold mb-4 text-center">{cookie.skillName}</h2>
                    <div className="flex justify-center"><img src={proxifyUrl(cookie.skillUrl) || `https://placehold.co/250x250/cccccc/000000?text=Skill`} alt="Skill" className="max-w-[250px] rounded-xl shadow-lg border-2 border-white/30" /></div>
                    <DescriptionWithIcons text={cookie.skillDescription} cookies={allCookies} />
                </div>
                {powerUp && <PowerUpItem item={powerUp} detailView allCookies={allCookies} />}
                {cookie.costumes?.length > 0 && (
                  <div className="bg-slate-800/50 p-6 rounded-2xl border-2 border-white/30">
                    <h2 className="text-2xl font-bold mb-4">Costumes</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {cookie.costumes.map((costume, index) => <CostumeItem key={index} costume={costume} onClick={() => onCostumeClick(costume)} />)}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
    );
}

const TIER_COLORS = { S: 'bg-red-500', A: 'bg-orange-500', B: 'bg-yellow-500', C: 'bg-green-500' };

const TierTag = ({ tier, type }) => {
    return (
         <div className={`flex items-center gap-2 px-4 py-1 text-sm font-semibold rounded-full shadow-inner ${TIER_COLORS[tier] || 'bg-gray-500'} border border-white border-opacity-50`}>
            <span>{type}: {tier} Tier</span>
        </div>
    )
}

const DetailTag = ({ type, value, getAttributeImageUrl }) => {
    const imageUrl = getAttributeImageUrl(type, value);
    return (
        <div className="flex items-center gap-2 px-4 py-1 text-sm font-semibold rounded-full shadow-inner bg-slate-800 bg-opacity-70 border border-white border-opacity-50">
            {imageUrl && <img src={proxifyUrl(imageUrl)} alt={value} className="h-8 w-8 object-contain" />}
            <span>{value}</span>
        </div>
    );
};

const PowerUpItem = ({ item, detailView, allCookies }) => (
    <div className={`p-6 rounded-2xl ${detailView ? 'bg-slate-800/50 border-2 border-[var(--color-highlight)]' : ''}`}>
        <h2 className="text-2xl font-bold mb-4 text-center">{item.name || 'Power-up'}</h2>
        <div className="bg-slate-700/70 rounded-xl p-4 shadow-lg border-2 border-white/30">
            <DescriptionWithIcons text={item.description} cookies={allCookies} />
            <div className="flex flex-col sm:flex-row justify-around items-center gap-4 mt-4">
                <div className="text-center"><img src={proxifyUrl(item.baseUrl) || 'https://placehold.co/100x100/cccccc/ffffff?text=Base'} alt="Base" className="w-24 h-24 rounded-lg mx-auto object-cover" /><p className="mt-2 font-semibold">Base</p></div>
                <div className="text-center"><img src={proxifyUrl(item.plus10Url) || 'https://placehold.co/100x100/cccccc/ffffff?text=%2B10'} alt="+10" className="w-24 h-24 rounded-lg mx-auto object-cover" /><p className="mt-2 font-semibold">+10</p></div>
                <div className="text-center"><img src={proxifyUrl(item.plus20Url) || 'https://placehold.co/100x100/cccccc/ffffff?text=%2B20'} alt="+20" className="w-24 h-24 rounded-lg mx-auto object-cover" /><p className="mt-2 font-semibold">+20</p></div>
            </div>
        </div>
    </div>
);

const CostumeItem = ({ costume, onClick }) => (
    <div onClick={onClick} className="group relative bg-slate-700/70 rounded-xl p-2 shadow-lg border-2 border-white/30 cursor-pointer hover:bg-slate-700 transition-colors aspect-square flex items-center justify-center overflow-hidden">
        <img src={proxifyUrl(costume.avatarUrl) || 'https://placehold.co/100x100/cccccc/000000?text=Avatar'} alt={`${costume.name} avatar`} className="w-full h-full rounded-lg object-cover" />
        <div className="absolute bottom-0 left-0 right-0 p-2 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300 rounded-b-xl text-center">
            <p className="text-sm font-semibold text-white leading-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" style={{textShadow: '1px 1px 2px rgba(0,0,0,0.9)'}}>{costume.name}</p>
        </div>
    </div>
);

function CookieForm({ cookie, onSave, onCancel, attributes, powerUps, onEditCostume }) {
    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState({ name: '', avatarUrl: '', spriteUrl: '', headIconUrl: '', skillName: '', skillUrl: '', skillDescription: '', rarity: '', role: '', elements: [], position: '', costumes: [], powerUpId: '' });
    const [newCostume, setNewCostume] = useState({ rarity: '', name: '', avatarUrl: '', spriteUrl: '' });

    useEffect(() => {
        const initialState = {
            name: '', avatarUrl: '', spriteUrl: '', headIconUrl: '', skillName: '', skillUrl: '', skillDescription: '',
            rarity: attributes.rarities[0]?.name || '',
            role: attributes.roles[0]?.name || '',
            elements: [],
            position: attributes.positions[0]?.name || '',
            costumes: [],
            powerUpId: '',
        };
        setNewCostume(p => ({ ...p, rarity: attributes.costumeRarities[0]?.name || ''}));

        if (cookie) {
            const elementsArray = Array.isArray(cookie.elements) ? cookie.elements : (cookie.element ? [cookie.element] : []);
            setFormData({ ...initialState, ...cookie, elements: elementsArray });
        } else {
            setFormData(initialState);
        }
    }, [cookie, attributes]);

    const handleChange = (e) => setFormData(p => ({ ...p, [e.target.name]: e.target.value }));
    const handleElementChange = (e) => {
        const { value, checked } = e.target;
        setFormData(prev => ({ ...prev, elements: checked ? [...(prev.elements || []), value] : (prev.elements || []).filter(el => el !== value) }));
    };
    const handleCostumeChange = (e) => setNewCostume(p => ({ ...p, [e.target.name]: e.target.value }));
    const addCostume = () => {
        if (newCostume.name) {
            setFormData(p => ({ ...p, costumes: [...(p.costumes || []), newCostume] }));
            setNewCostume({ rarity: attributes.costumeRarities[0]?.name || '', name: '', avatarUrl: '', spriteUrl: '' });
        }
    };
    const removeCostume = (index) => setFormData(p => ({ ...p, costumes: p.costumes.filter((_, i) => i !== index) }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        await onSave(formData, cookie?.id);
        setIsSaving(false);
    };

    const selectedRarity = attributes.rarities.find(r => r.name === formData.rarity);
    const canHavePowerUp = selectedRarity?.allowsPowerUp;

    return (
        <div className="bg-slate-800 text-white rounded-2xl shadow-xl w-full max-w-4xl p-6 relative my-8 max-h-[90vh] overflow-y-auto">
          <button onClick={onCancel} className="absolute top-4 right-4 text-gray-400 hover:text-white"><Icon path="M6 18L18 6M6 6l12 12" /></button>
          <h2 className="text-3xl font-bold mb-6 text-center">{cookie ? 'Edit Cookie' : 'Add New Cookie'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormInput name="name" value={formData.name || ''} onChange={handleChange} required disabled={isSaving} />
            <div className="grid md:grid-cols-3 gap-4">
              <FormInput name="avatarUrl" label="Avatar URL" type="url" value={formData.avatarUrl || ''} onChange={handleChange} disabled={isSaving} />
              <FormInput name="spriteUrl" label="Illustration URL" type="url" value={formData.spriteUrl || ''} onChange={handleChange} disabled={isSaving} />
              <FormInput name="headIconUrl" label="Head Icon URL" type="url" value={formData.headIconUrl || ''} onChange={handleChange} disabled={isSaving} />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <FormInput name="skillName" label="Skill Name" value={formData.skillName || ''} onChange={handleChange} required disabled={isSaving} />
              <FormInput name="skillUrl" label="Skill URL" type="url" value={formData.skillUrl || ''} onChange={handleChange} disabled={isSaving} />
            </div>
            <FormTextarea name="skillDescription" label="Skill Description" value={formData.skillDescription || ''} onChange={handleChange} disabled={isSaving} />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FormSelect name="rarity" value={formData.rarity} onChange={handleChange} options={attributes.rarities} disabled={isSaving} />
              <FormSelect name="role" value={formData.role} onChange={handleChange} options={attributes.roles} disabled={isSaving} />
              <FormSelect name="position" value={formData.position} onChange={handleChange} options={attributes.positions} disabled={isSaving} />
            </div>
            <div>
                <label className="block text-sm font-medium mb-2">Elements</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 bg-slate-700/50 rounded-md">
                    {attributes.elements.map(element => (<Checkbox key={element.id} label={element.name} checked={(formData.elements || []).includes(element.name)} onChange={handleElementChange} value={element.name} disabled={isSaving} imageUrl={element.imageUrl}/>))}
                </div>
            </div>

            {canHavePowerUp && (
                <FormSelect name="powerUpId" label="Power-up" value={formData.powerUpId} onChange={handleChange} options={powerUps} includeNone disabled={isSaving} useIdAsValue />
            )}

            <CostumeManager skins={formData.costumes} newSkin={newCostume} onSkinChange={handleCostumeChange} onAddSkin={addCostume} onRemoveSkin={removeCostume} rarities={attributes.costumeRarities} disabled={isSaving} onEditCostume={onEditCostume} />
            <div className="flex justify-end pt-4"><div className="flex items-center bg-slate-700/50 rounded-full shadow-lg p-1 space-x-1"><button type="button" onClick={onCancel} disabled={isSaving} className="px-6 py-2 text-white opacity-80 hover:bg-slate-600/50 transition-colors rounded-full disabled:opacity-50">Cancel</button><button type="submit" disabled={isSaving} className="px-6 py-2 w-36 bg-green-500 text-white font-bold rounded-full hover:bg-green-600 disabled:bg-green-700 flex items-center justify-center">{isSaving ? 'Saving...' : 'Save'}</button></div></div>
          </form>
        </div>
    );
}

const FormInput = ({ name, label, ...props }) => (<div><label className="block text-sm font-medium mb-1 capitalize">{label || name}</label><input name={name} {...props} autoComplete="off" className="w-full px-3 py-2 bg-slate-700 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:bg-slate-600" /></div>);
const FormTextarea = ({ name, label, ...props }) => (<div><label className="block text-sm font-medium mb-1 capitalize">{label || name}</label><textarea name={name} {...props} rows="3" className="w-full px-3 py-2 bg-slate-700 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:bg-slate-600" /></div>);
const FormSelect = ({ name, value, onChange, options, label, disabled, includeNone, useIdAsValue }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectRef = useRef(null);
    const selectedOption = useIdAsValue ? options.find(opt => opt.id === value) : options.find(opt => opt.name === value);

    useEffect(() => {
        const handleClickOutside = (event) => { if (selectRef.current && !selectRef.current.contains(event.target)) setIsOpen(false); };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSelect = (optionValue) => { if (!disabled) { onChange({ target: { name, value: optionValue } }); setIsOpen(false); }};

    return (
        <div>
            <label className="block text-sm font-medium mb-1 capitalize">{label || name}</label>
            <div className="relative" ref={selectRef}>
                <button type="button" onClick={() => !disabled && setIsOpen(!isOpen)} className="w-full px-3 py-2 bg-slate-700 rounded-md border border-slate-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:bg-slate-600 flex items-center justify-between text-left" disabled={disabled}>
                    <span className="flex items-center">{selectedOption?.imageUrl && <img src={proxifyUrl(selectedOption.imageUrl)} alt={selectedOption.name} className="h-6 w-6 mr-2 object-contain" />} {selectedOption?.name || 'None'}</span>
                    <Icon path="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" className="w-5 h-5 text-gray-400" />
                </button>
                {isOpen && (<ul className="absolute z-20 mt-1 w-full bg-slate-600 border border-slate-500 rounded-md shadow-lg max-h-60 overflow-auto">
                    {includeNone && <li onClick={() => handleSelect('')} className="flex items-center px-3 py-2 text-sm text-white hover:bg-slate-500 cursor-pointer">None</li>}
                    {options.map(option => (<li key={option.id || option.name} onClick={() => handleSelect(useIdAsValue ? option.id : option.name)} className="flex items-center px-3 py-2 text-sm text-white hover:bg-slate-500 cursor-pointer">{option?.imageUrl && <img src={proxifyUrl(option.imageUrl)} alt={option.name} className="h-6 w-6 mr-2 object-contain" />} {option.name}</li>))}
                </ul>)}
            </div>
        </div>
    );
};
const CostumeManager = ({ skins, newSkin, onSkinChange, onAddSkin, onRemoveSkin, rarities, disabled, onEditCostume }) => (
    <div className="border border-gray-600 p-4 rounded-md space-y-4">
        <h3 className="text-xl font-semibold">Manage Costumes</h3>
        {skins?.length > 0 ? (<div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">{skins.map((skin, index) => (<div key={index} className="relative group aspect-square"><img src={proxifyUrl(skin.avatarUrl) || 'https://placehold.co/100x100/cccccc/000000?text=Skin'} alt={skin.name} className="w-full h-full rounded-md object-cover" /><div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1"><p className="text-white text-xs text-center font-bold mb-1">{skin.name}</p><div className="flex space-x-1"><button type="button" onClick={() => onEditCostume(skin)} className="p-1 bg-[var(--color-primary)]/80 rounded-full text-white" disabled={disabled}><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.652.663c-.15.037-.301.037-.451 0a2.148 2.148 0 01-1.464-1.464c-.037-.15-.037-.3 0-.451l.663-2.652a4.5 4.5 0 011.13-1.897L16.863 4.487z" className="w-3 h-3"/></button><button type="button" onClick={() => onRemoveSkin(index)} className="p-1 bg-red-500/80 rounded-full text-white" disabled={disabled}><Icon path="M6 18L18 6M6 6l12 12" className="w-3 h-3"/></button></div></div></div>))}</div>) : <p className="text-slate-400 text-sm">No Costumes Added Yet.</p>}
        <div className="border-t border-gray-700 pt-4"><h4 className="text-lg font-semibold mb-2">Add New Costume</h4><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end"><FormInput name="name" label="Costume Name" value={newSkin.name} onChange={onSkinChange} disabled={disabled} /><FormSelect name="rarity" value={newSkin.rarity} onChange={onSkinChange} options={rarities} disabled={disabled} /><FormInput name="avatarUrl" label="Avatar URL" type="url" value={newSkin.avatarUrl} onChange={onSkinChange} disabled={disabled} /><FormInput name="spriteUrl" label="Illustration URL" type="url" value={newSkin.spriteUrl} onChange={onSkinChange} disabled={disabled} /><button type="button" onClick={onAddSkin} className="md:col-start-3 px-4 py-2 bg-[var(--color-primary)] text-white font-bold rounded-md hover:bg-[var(--color-accent)] disabled:opacity-50" disabled={disabled || !newSkin.name}>Add Costume</button></div></div>
    </div>
);

function AttributeManager({ attributes, onSave, onDelete, activeTab, setActiveTab }) {
    const [formData, setFormData] = useState({ name: '', imageUrl: '', allowsPowerUp: false });
    const [editingId, setEditingId] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const currentList = attributes[activeTab] || [];
    const typeSingular = activeTab.endsWith('s') ? activeTab.slice(0, -1).replace(/([A-Z])/g, ' $1').toLowerCase() : activeTab;

    const handleSubmit = async (e) => {
      e.preventDefault();
      if (formData.name) {
        setIsSaving(true);
        const dataToSave = { name: formData.name, imageUrl: formData.imageUrl, createdAt: serverTimestamp() };
        if (activeTab === 'rarities') dataToSave.allowsPowerUp = formData.allowsPowerUp;
        await onSave(activeTab, dataToSave, editingId);
        setFormData({ name: '', imageUrl: '', allowsPowerUp: false });
        setEditingId(null);
        setIsSaving(false);
      }
    };
    const handleEdit = (attr) => { setEditingId(attr.id); setFormData({ name: attr.name, imageUrl: attr.imageUrl || '', allowsPowerUp: attr.allowsPowerUp || false });};
    const handleCancel = () => { setEditingId(null); setFormData({ name: '', imageUrl: '', allowsPowerUp: false });};

    const tabs = [{ key: 'rarities', icon: 'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z', label: 'Cookie Rarities' },{ key: 'costumeRarities', icon: 'M9 3h6l2 2v5h2v11H5V10h2V5l2-2z', label: 'Costume Rarities' }, { key: 'powerUpTypes', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z', label: 'Power-up Types' },{ key: 'roles', icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.248-8.25-3.286zm0 13.036h.008v.016h-.008v-.016z', label: 'Roles' },{ key: 'elements', icon: 'M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.601a8.983 8.983 0 012.351-5.175 8.342 8.342 0 011.011-1.21z', label: 'Elements' },{ key: 'positions', icon: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5', label: 'Positions' }];

    return (
        <div className="container mx-auto max-w-4xl"><header className="mb-10 text-center"><h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg">Manage Attributes</h1></header><div className="bg-slate-800 text-white rounded-2xl p-6 shadow-xl"><div className="flex flex-wrap justify-center items-center gap-2 md:gap-4 mb-8">{tabs.map(tab => (<button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center px-4 py-2 rounded-full font-bold transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)]' : 'bg-slate-700 hover:bg-slate-600'}`}><Icon path={tab.icon} className="h-5 w-5 mr-2" /><span className="capitalize">{tab.label}</span></button>))}</div><form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-slate-900/50 p-4 rounded-lg"><h2 className="text-2xl font-semibold capitalize">{editingId ? 'Edit' : 'Add New'} {typeSingular}</h2><div className="grid md:grid-cols-2 gap-4"><FormInput name="name" value={formData.name} onChange={(e) => setFormData(p => ({...p, name: e.target.value}))} required disabled={isSaving}/><FormInput name="imageUrl" label="Icon/Image URL" type="url" value={formData.imageUrl} onChange={(e) => setFormData(p => ({...p, imageUrl: e.target.value}))} disabled={isSaving}/></div>{activeTab === 'rarities' && <Checkbox label="Allows Power-up" checked={formData.allowsPowerUp} onChange={e => setFormData(p => ({...p, allowsPowerUp: e.target.checked}))} />}<div className="flex justify-end space-x-2">{editingId && <button type="button" onClick={handleCancel} className="px-4 py-2 bg-gray-500 rounded-full hover:bg-gray-600" disabled={isSaving}>Cancel</button>}<button type="submit" className="px-4 py-2 bg-green-500 rounded-full hover:bg-green-600 disabled:bg-green-700 disabled:cursor-not-allowed" disabled={isSaving}>{isSaving ? 'Saving...' : (editingId ? 'Save Changes' : 'Save')}</button></div></form><h2 className="text-2xl font-semibold mb-4 capitalize">Existing {typeSingular}s</h2><ul className="space-y-2 max-h-80 overflow-y-auto pr-2">{currentList.map(attr => (<li key={attr.id} className="flex items-center justify-between bg-slate-700 p-3 rounded-md shadow-md"><div className="flex items-center space-x-4">{attr.imageUrl && <img src={proxifyUrl(attr.imageUrl)} alt={attr.name} className="w-8 h-8 object-contain" />}{attr.name}</div><div className="flex items-center space-x-2">{activeTab === 'rarities' && attr.allowsPowerUp && <Icon path="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" className="w-5 h-5 text-purple-400" />}<button onClick={() => handleEdit(attr)} className="text-[var(--color-primary)] hover:opacity-80"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.652.663c-.15.037-.301.037-.451 0a2.148 2.148 0 01-1.464-1.464c-.037-.15-.037-.3 0-.451l.663-2.652a4.5 4.5 0 011.13-1.897L16.863 4.487z" className="w-5 h-5"/></button><button onClick={() => onDelete(activeTab, attr.id)} className="text-red-400 hover:text-red-500"><Icon path="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m-1.022.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m-1.022.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79" className="w-5 h-5"/></button></div></li>))}</ul></div></div>
    );
}

const Checkbox = ({ label, checked, onChange, disabled, value, imageUrl }) => (
    <label className="flex items-center space-x-3 cursor-pointer p-2 rounded-md hover:bg-slate-600/50 transition-colors">
        <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} value={value} className="form-checkbox h-5 w-5 text-[var(--color-primary)] bg-gray-800 border-gray-600 rounded focus:ring-[var(--color-primary)]" />
        <div className="flex items-center gap-2">{imageUrl && <img src={proxifyUrl(imageUrl)} alt={label} className="w-6 h-6 object-contain" />}<span>{label}</span></div>
    </label>
);

function CostumeManagerView({ cookies, getAttributeImageUrl, onCostumeClick, attributes }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sort, setSort] = useState({ option: 'rarity', direction: 'asc' });
    const [collapsedRarities, setCollapsedRarities] = useState({});

    const handleSort = (option) => setSort(prev => ({ option, direction: prev.option === option && prev.direction === 'asc' ? 'desc' : 'asc' }));

    const allCostumes = useMemo(() => cookies.flatMap(cookie => (cookie.costumes || []).map(costume => ({ ...costume, cookie }))), [cookies]);
    const filteredCostumes = useMemo(() => allCostumes.filter(costume => costume.name.toLowerCase().includes(searchTerm.toLowerCase()) || costume.cookie.name.toLowerCase().includes(searchTerm.toLowerCase())), [allCostumes, searchTerm]);

    const sortedCostumes = useMemo(() => [...filteredCostumes].sort((a, b) => {
        let comparison = 0;
        if (sort.option === 'rarity') {
            const rarityOrder = attributes.costumeRarities.map(r => r.name);
            comparison = (rarityOrder.indexOf(a.rarity) ?? Infinity) - (rarityOrder.indexOf(b.rarity) ?? Infinity);
        } else if (sort.option === 'costumeName') comparison = a.name.localeCompare(b.name);
        else comparison = a.cookie.name.localeCompare(b.cookie.name);
        return sort.direction === 'asc' ? comparison : -comparison;
    }), [filteredCostumes, sort, attributes.costumeRarities]);

    const groupedCostumes = useMemo(() => sortedCostumes.reduce((acc, costume) => {
        const rarity = costume.rarity || 'Common';
        (acc[rarity] = acc[rarity] || []).push(costume);
        return acc;
    }, {}), [sortedCostumes]);

    if (allCostumes.length === 0) return (<div className="text-center py-20"><Icon path="M9 3h6l2 2v5h2v11H5V10h2V5l2-2z" className="w-24 h-24 mx-auto text-white opacity-50" /><h2 className="mt-4 text-2xl font-bold text-white opacity-80">No Costumes Found</h2><p className="text-white opacity-60">Add costumes to cookies to see them here.</p></div>)

    return (
        <div>
            <header className="mb-10 text-center"><h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg">Cookie Costumes</h1><div className="flex flex-col md:flex-row justify-center items-center mt-6 gap-4"><div className="relative w-full md:w-auto"><input type="text" placeholder="Search for a costume or cookie..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full md:w-96 bg-slate-800/70 text-white placeholder-white placeholder-opacity-60 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" /><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="w-5 h-5 text-white opacity-60" /></div></div><div className="flex items-center gap-2"><span className="text-sm font-semibold text-white">Sort:</span><div className="flex items-center bg-slate-800/70 rounded-full shadow-lg p-1"><SortButton option="rarity" text="Rarity" currentSort={sort} onSort={handleSort} /><div className="w-px h-5 bg-slate-600"></div><SortButton option="costumeName" text="Costume" currentSort={sort} onSort={handleSort} /><div className="w-px h-5 bg-slate-600"></div><SortButton option="cookieName" text="Cookie" currentSort={sort} onSort={handleSort} /></div></div></div></header>
            <div className="space-y-10">{sort.option === 'rarity' ? (Object.entries(groupedCostumes).map(([rarityName, costumes]) => (<RaritySection key={rarityName} rarityName={rarityName} items={costumes} collapsedRarities={collapsedRarities} setCollapsedRarities={setCollapsedRarities} getAttributeImageUrl={getAttributeImageUrl} onCardClick={onCostumeClick} itemType="costume" />))) : (<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-8">{sortedCostumes.map((costume) => (<CostumeCard key={`${costume.cookie.id}-${costume.name}`} costume={costume} onCardClick={() => onCostumeClick(costume)} getAttributeImageUrl={getAttributeImageUrl} />))}</div>)}</div>
        </div>
    );
}

const CostumeCard = ({ costume, onCardClick, getAttributeImageUrl }) => {
    return (
        <div onClick={onCardClick} className="group relative aspect-square overflow-hidden cursor-pointer">
            <img src={proxifyUrl(costume.avatarUrl) || 'https://placehold.co/400x400/cccccc/000000?text=Costume'} alt={costume.name} className="w-full h-full object-cover rounded-2xl" />
            <div className="absolute bottom-0 left-0 right-0 p-2 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300 text-center">
                <h3 className="text-lg font-bold text-white leading-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" style={{textShadow: '1px 1px 2px rgba(0,0,0,0.9)'}}>{costume.name}</h3>
                <p className="text-sm text-white opacity-80 leading-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" style={{textShadow: '1px 1px 2px rgba(0,0,0,0.9)'}}>{costume.cookie?.name}</p>
            </div>
            {costume.cookie?.headIconUrl && <img src={proxifyUrl(costume.cookie.headIconUrl)} className="absolute top-3 left-3 w-10 h-10 object-contain drop-shadow-lg" alt="head icon"/>}
            {getAttributeImageUrl('costumeRarity', costume.rarity) && (<img src={proxifyUrl(getAttributeImageUrl('costumeRarity', costume.rarity))} alt={costume.rarity} className="absolute top-3 right-3 h-8 object-contain drop-shadow-lg" />)}
        </div>
    )
}

function CostumeDetail({ costume, onClose, onEdit, onDelete }) {
    return (
        <div className="w-full max-w-4xl relative text-white rounded-2xl mb-8 max-h-[90vh] overflow-y-auto bg-slate-900/80 backdrop-blur-lg border-2 border-gray-600 p-8">
            <div className="absolute top-4 right-4 flex items-center bg-slate-800/70 rounded-full shadow-lg z-10"><button onClick={() => onEdit(costume)} className="p-3 text-[var(--color-primary)] hover:opacity-80 transition-colors"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L7.582 19.82a2.25 2.25 0 01-1.06.58L3.75 21l.663-2.75a2.25 2.25 0 01.58-1.06l11.872-11.872zM15.75 5.25l2.25 2.25" className="w-5 h-5" /></button><div className="w-px h-5 bg-slate-600"></div><button onClick={() => onDelete(costume)} className="p-3 text-red-400 hover:text-red-300 transition-colors"><Icon path="M19 7l-.867 12.143A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.857L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" className="w-5 h-5" /></button><div className="w-px h-5 bg-slate-600"></div><button onClick={onClose} className="p-3 text-white opacity-70 hover:opacity-100 transition-colors"><Icon path="M6 18L18 6M6 6l12 12" className="w-5 h-5" /></button></div>
            <div className="text-center pt-8"><h1 className="text-4xl font-extrabold tracking-wide mb-2">{costume.name}</h1><p className="text-lg text-white opacity-80 mb-4 flex items-center justify-center gap-2">Costume for {costume.cookie?.headIconUrl && <img src={proxifyUrl(costume.cookie.headIconUrl)} className="w-8 h-8 object-contain" alt="head icon"/>}<span>{costume.cookie?.name}</span></p><div className="grid md:grid-cols-2 gap-8 items-center"><div><h3 className="text-xl font-bold mb-2">Avatar</h3><div className="aspect-square w-full"><img src={proxifyUrl(costume.avatarUrl) || 'https://placehold.co/400x400/cccccc/000000?text=Avatar'} alt={`${costume.name} avatar`} className="w-full h-full object-contain rounded-xl shadow-lg" /></div></div><div><h3 className="text-xl font-bold mb-2">Illustration</h3><div className="aspect-square w-full"><img src={proxifyUrl(costume.spriteUrl) || 'https://placehold.co/400x400/cccccc/000000?text=Illustration'} alt={`${costume.name} illustration`} className="w-full h-full object-contain rounded-xl shadow-lg" /></div></div></div></div>
        </div>
    );
}

function CostumeForm({ costume, onSave, onCancel, attributes }) {
    const [formData, setFormData] = useState(costume || { name: '', rarity: '', avatarUrl: '', spriteUrl: '' });
    const [isSaving, setIsSaving] = useState(false);
    const handleChange = (e) => setFormData(p => ({ ...p, [e.target.name]: e.target.value }));
    const handleSubmit = async (e) => { e.preventDefault(); setIsSaving(true); await onSave(formData, costume.cookie.id); setIsSaving(false); };

    return (
        <div className="bg-slate-800 text-white rounded-2xl shadow-xl w-full max-w-4xl p-6 relative my-8 max-h-[90vh] overflow-y-auto"><button onClick={onCancel} className="absolute top-4 right-4 text-white opacity-70 hover:opacity-100"><Icon path="M6 18L18 6M6 6l12 12" /></button><h2 className="text-3xl font-bold mb-6 text-center">Edit Costume</h2><form onSubmit={handleSubmit} className="space-y-4"><FormInput name="name" value={formData.name} onChange={handleChange} required disabled={isSaving} /><FormSelect name="rarity" value={formData.rarity} onChange={handleChange} options={attributes.costumeRarities} disabled={isSaving} /><FormInput name="avatarUrl" label="Avatar URL" type="url" value={formData.avatarUrl} onChange={handleChange} disabled={isSaving} /><FormInput name="spriteUrl" label="Illustration URL" type="url" value={formData.spriteUrl} onChange={handleChange} disabled={isSaving} /><div className="flex justify-end pt-4"><button type="submit" disabled={isSaving} className="px-6 py-2 w-48 bg-green-500 text-white font-bold rounded-full hover:bg-green-600 disabled:bg-green-700 flex items-center justify-center">{isSaving ? 'Saving...' : 'Save Changes'}</button></div></form></div>
    );
}

// --- Power-up Components ---
function PowerUpManagerView({ powerUps, cookies, attributes, onCardClick }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [sort, setSort] = useState({ option: 'name', direction: 'asc' });

    const enrichedPowerUps = useMemo(() => {
        return powerUps.map(p => ({
            ...p,
            cookie: cookies.find(c => c.powerUpId === p.id)
        }));
    }, [powerUps, cookies]);

    const filteredPowerUps = enrichedPowerUps.filter(pu =>
        (pu.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (pu.cookie?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const sortedPowerUps = [...filteredPowerUps].sort((a, b) => {
        let comparison = 0;
        if (sort.option === 'name') comparison = (a.name || '').localeCompare(b.name || '');
        else if (sort.option === 'type') comparison = (a.type || '').localeCompare(b.type || '');
        else comparison = (a.cookie?.name || '').localeCompare(b.cookie?.name || '');
        return sort.direction === 'asc' ? comparison : -comparison;
    });

    const handleSort = (option) => setSort(prev => ({ option, direction: prev.option === option && prev.direction === 'asc' ? 'desc' : 'asc' }));

    if (powerUps.length === 0) {
        return (<div className="text-center py-20"><Icon path="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" className="w-24 h-24 mx-auto text-white opacity-50" /><h2 className="mt-4 text-2xl font-bold text-white opacity-80">No Power-ups Found</h2><p className="text-white opacity-60">Click the '+' button to add a new power-up.</p></div>)
    }
    return (
        <div>
            <header className="mb-10 text-center"><h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg">Manage Power-ups</h1><div className="flex flex-col md:flex-row justify-center items-center mt-6 gap-4"><div className="relative w-full md:w-auto"><input type="text" placeholder="Search for a power-up or cookie..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full md:w-96 bg-slate-800/70 text-white placeholder-white placeholder-opacity-60 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]" /><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="w-5 h-5 text-white opacity-60" /></div></div><div className="flex items-center gap-2"><span className="text-sm font-semibold text-white">Sort:</span><div className="flex items-center bg-slate-800/70 rounded-full shadow-lg p-1"><SortButton option="name" text="Name" currentSort={sort} onSort={handleSort} /><div className="w-px h-5 bg-slate-600"></div><SortButton option="type" text="Type" currentSort={sort} onSort={handleSort} /><div className="w-px h-5 bg-slate-600"></div><SortButton option="cookie" text="Cookie" currentSort={sort} onSort={handleSort} /></div></div></div></header>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {sortedPowerUps.map(powerUp => (
                    <PowerUpCard key={powerUp.id} powerUp={powerUp} attributes={attributes} onCardClick={() => onCardClick('powerUpDetail', powerUp)} />
                ))}
            </div>
        </div>
    );
}

const PowerUpCard = ({ powerUp, attributes, onCardClick }) => {
    const typeImageUrl = attributes.powerUpTypes?.find(t => t.name === powerUp.type)?.imageUrl;

    return (
        <div onClick={onCardClick} className="group relative aspect-square overflow-hidden cursor-pointer rounded-2xl shadow-xl bg-slate-800">
            <img src={proxifyUrl(powerUp.baseUrl) || 'https://placehold.co/200x200/cccccc/000000?text=Power-up'} alt={powerUp.name} className="relative z-10 w-full h-full object-contain p-4 drop-shadow-lg" />
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-black bg-opacity-60 transform translate-y-full group-hover:translate-y-0 transition-transform duration-300 text-center z-20"><h3 className="text-lg font-bold text-white text-center drop-shadow-lg leading-tight">{powerUp.name || 'Unnamed'}</h3><p className="text-sm text-white opacity-80 text-center leading-tight">{powerUp.cookie?.name || 'Unassigned'}</p></div>
            {powerUp.cookie?.headIconUrl && <img src={proxifyUrl(powerUp.cookie.headIconUrl)} className="absolute top-3 left-3 w-10 h-10 object-contain z-20" alt="head icon"/>}
            {typeImageUrl && <img src={proxifyUrl(typeImageUrl)} alt={powerUp.type} className="absolute top-3 right-3 w-10 h-10 object-contain z-20" />}
        </div>
    );
};

function PowerUpDetail({ powerUp, allCookies, onClose, onEdit, onDelete }) {
    const cookie = allCookies.find(c => c.powerUpId === powerUp.id);

    return (
        <div className="w-full max-w-4xl relative text-white rounded-2xl mb-8 max-h-[90vh] overflow-y-auto bg-slate-900/80 backdrop-blur-lg border-2 border-[var(--color-highlight)] p-8">
            <div className="absolute top-4 right-4 flex items-center bg-slate-800/70 rounded-full shadow-lg z-10"><button onClick={() => onEdit(powerUp)} className="p-3 text-[var(--color-primary)] hover:opacity-80"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L7.582 19.82a2.25 2.25 0 01-1.06.58L3.75 21l.663-2.75a2.25 2.25 0 01.58-1.06l11.872-11.872zM15.75 5.25l2.25 2.25" className="w-5 h-5" /></button><div className="w-px h-5 bg-slate-600"></div><button onClick={() => onDelete(powerUp.id)} className="p-3 text-red-400 hover:text-red-300"><Icon path="M19 7l-.867 12.143A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.857L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" className="w-5 h-5" /></button><div className="w-px h-5 bg-slate-600"></div><button onClick={onClose} className="p-3 text-gray-400 hover:text-white"><Icon path="M6 18L18 6M6 6l12 12" className="w-5 h-5" /></button></div>
            <div className="pt-12 text-center"><h1 className="text-4xl font-extrabold tracking-wide mb-2">{powerUp.name}</h1><p className="text-lg text-white opacity-80 mb-4 flex items-center justify-center gap-2"><span>{powerUp.type} for</span>{cookie?.headIconUrl && <img src={proxifyUrl(cookie.headIconUrl)} className="w-8 h-8 object-contain" alt="head icon"/>}<span>{cookie?.name || "Unassigned"}</span></p><div className="mt-6 bg-slate-800/50 p-6 rounded-2xl border-2 border-white/30"><DescriptionWithIcons text={powerUp.description} cookies={allCookies} /></div><div className="flex flex-col sm:flex-row justify-around items-center gap-4 mt-8"><div className="text-center"><img src={proxifyUrl(powerUp.baseUrl) || 'https://placehold.co/100x100/cccccc/ffffff?text=Base'} alt="Base" className="w-24 h-24 rounded-lg mx-auto object-cover" /><p className="mt-2 font-semibold">Base</p></div><div className="text-center"><img src={proxifyUrl(powerUp.plus10Url) || 'https://placehold.co/100x100/cccccc/ffffff?text=%2B10'} alt="+10" className="w-24 h-24 rounded-lg mx-auto object-cover" /><p className="mt-2 font-semibold">+10</p></div><div className="text-center"><img src={proxifyUrl(powerUp.plus20Url) || 'https://placehold.co/100x100/cccccc/ffffff?text=%2B20'} alt="+20" className="w-24 h-24 rounded-lg mx-auto object-cover" /><p className="mt-2 font-semibold">+20</p></div></div></div>
        </div>
    );
}

function PowerUpForm({ powerUp, onSave, onCancel, attributes }) {
    const [formData, setFormData] = useState(powerUp || { name: '', description: '', type: '', baseUrl: '', plus10Url: '', plus20Url: '' });
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!powerUp && attributes.powerUpTypes.length > 0) {
            setFormData(p => ({ ...p, type: attributes.powerUpTypes[0].name }));
        }
    }, [powerUp, attributes.powerUpTypes]);

    const handleChange = (e) => setFormData(p => ({ ...p, [e.target.name]: e.target.value }));
    const handleSubmit = async (e) => { e.preventDefault(); setIsSaving(true); await onSave(formData, powerUp?.id); setIsSaving(false); };

    return (
        <div className="bg-slate-800 text-white rounded-2xl shadow-xl w-full max-w-4xl p-6 relative my-8 max-h-[90vh] overflow-y-auto"><button onClick={onCancel} className="absolute top-4 right-4 text-white opacity-70 hover:opacity-100"><Icon path="M6 18L18 6M6 6l12 12" /></button><h2 className="text-3xl font-bold mb-6 text-center">{powerUp ? 'Edit Power-up' : 'Add New Power-up'}</h2><form onSubmit={handleSubmit} className="space-y-4"><FormInput name="name" value={formData.name || ''} onChange={handleChange} required disabled={isSaving} /><FormSelect name="type" label="Power-up Type" value={formData.type} onChange={handleChange} options={attributes.powerUpTypes} disabled={isSaving} /><FormTextarea name="description" value={formData.description || ''} onChange={handleChange} disabled={isSaving} /><div className="grid md:grid-cols-3 gap-4"><FormInput name="baseUrl" label="Base Image URL" type="url" value={formData.baseUrl || ''} onChange={handleChange} disabled={isSaving} /><FormInput name="plus10Url" label="+10 Image URL" type="url" value={formData.plus10Url || ''} onChange={handleChange} disabled={isSaving} /><FormInput name="plus20Url" label="+20 Image URL" type="url" value={formData.plus20Url || ''} onChange={handleChange} disabled={isSaving} /></div><div className="flex justify-end pt-4"><button type="submit" disabled={isSaving} className="px-6 py-2 w-36 bg-green-500 text-white font-bold rounded-full hover:bg-green-600 disabled:bg-green-700 flex items-center justify-center">{isSaving ? 'Saving...' : 'Save'}</button></div></form></div>
    );
}

// --- Tier List Components ---
function TierListView({ cookies, tierLists, onSave, attributes, openModal }) {
    const [activeTab, setActiveTab] = useState('pvp');
    const [draggedCookieId, setDraggedCookieId] = useState(null);
    const [unrankedSearch, setUnrankedSearch] = useState('');

    const activeTierList = tierLists[activeTab];
    const tiers = activeTierList.tiers || [];

    const cookieMap = useMemo(() => new Map(cookies.map(c => [c.id, c])), [cookies]);

    const allRankedCookies = useMemo(() => new Set(tiers.flatMap(t => t.cookieIds)), [tiers]);

    const unrankedCookies = useMemo(() => {
        const rarityOrder = attributes.rarities.map(r => r.name);
        return cookies
            .filter(c => !allRankedCookies.has(c.id) && c.name.toLowerCase().includes(unrankedSearch.toLowerCase()))
            .sort((a,b) => (rarityOrder.indexOf(a.rarity) ?? Infinity) - (rarityOrder.indexOf(b.rarity) ?? Infinity));
    }, [cookies, allRankedCookies, unrankedSearch, attributes.rarities]);

    const handleDragStart = (e, cookieId) => {
        setDraggedCookieId(cookieId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e) => { e.preventDefault(); };

    const handleDrop = (e, targetTierId) => {
        e.preventDefault();
        if (!draggedCookieId) return;

        const newTiers = tiers.map(tier => {
            return { ...tier, cookieIds: tier.cookieIds.filter(id => id !== draggedCookieId) };
        });

        if (targetTierId !== 'unranked') {
            const targetTier = newTiers.find(t => t.id === targetTierId);
            if(targetTier) {
                targetTier.cookieIds.push(draggedCookieId);
            }
        }

        onSave({ ...activeTierList, tiers: newTiers });
        setDraggedCookieId(null);
    };

    const handleEditTiers = () => {
        openModal('tierEditor', { tierList: activeTierList, onSave });
    };

    const TierRow = ({ tier }) => (
        <div
            className="flex items-stretch bg-slate-800/50 rounded-lg"
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, tier.id)}
        >
            <div className={`w-24 flex-shrink-0 flex items-center justify-center text-4xl font-extrabold text-white rounded-l-lg ${tier.color}`}>
                {tier.name}
            </div>
            <div className="flex-1 p-4 min-h-[96px] flex flex-wrap gap-2">
                {tier.cookieIds.map(id => {
                    const cookie = cookieMap.get(id);
                    if (!cookie) return null;
                    return (
                        <img key={id} src={proxifyUrl(cookie.headIconUrl)} alt={cookie.name} title={cookie.name} draggable onDragStart={(e) => handleDragStart(e, cookie.id)} className="w-16 h-16 object-contain cursor-grab rounded-md bg-slate-700/50 p-1 transition-transform hover:scale-110"/>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div>
            <header className="mb-6 text-center flex justify-between items-center">
                <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-lg">Cookie Tier List</h1>
                 <button onClick={handleEditTiers} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-full transition-colors">
                    <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" className="w-5 h-5"/>
                    <span>Edit Tiers</span>
                </button>
            </header>

            <div className="flex justify-center mb-6 bg-slate-900/50 rounded-full p-1 border border-slate-700">
                <button onClick={() => setActiveTab('pvp')} className={`px-6 py-2 text-lg font-bold transition-colors rounded-full ${activeTab === 'pvp' ? 'text-white bg-[var(--color-primary)]' : 'text-slate-400 hover:bg-slate-700/50'}`}>PvP (Arena)</button>
                <button onClick={() => setActiveTab('pve')} className={`px-6 py-2 text-lg font-bold transition-colors rounded-full ${activeTab === 'pve' ? 'text-white bg-[var(--color-primary)]' : 'text-slate-400 hover:bg-slate-700/50'}`}>PvE (Story)</button>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                 <div className="flex-1 space-y-4">
                    {tiers.map((tier) => ( <TierRow key={tier.id} tier={tier} /> ))}
                </div>

                <div className="w-full lg:w-72 xl:w-80 flex-shrink-0" onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, 'unranked')}>
                     <div className="bg-slate-900/70 p-4 rounded-lg sticky top-8">
                        <h2 className="text-2xl font-bold text-center text-white mb-4">Unranked</h2>
                         <div className="relative mb-4">
                            <input type="text" placeholder="Search cookies..." value={unrankedSearch} onChange={e => setUnrankedSearch(e.target.value)} className="w-full bg-slate-800/70 text-white placeholder-white placeholder-opacity-60 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"/>
                             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Icon path="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" className="w-5 h-5 text-white opacity-60" /></div>
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center max-h-[calc(100vh-20rem)] overflow-y-auto pr-2">
                            {unrankedCookies.map(cookie => (
                                <img key={cookie.id} src={proxifyUrl(cookie.headIconUrl)} alt={cookie.name} title={cookie.name} draggable onDragStart={(e) => handleDragStart(e, cookie.id)} className="w-16 h-16 object-contain cursor-grab rounded-md bg-slate-700/50 p-1 transition-transform hover:scale-110"/>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function TierEditorModal({ tierList, onSave, onCancel }) {
    const [tiers, setTiers] = useState(tierList.tiers || []);
    const [isSaving, setIsSaving] = useState(false);

    const handleTierChange = (index, field, value) => {
        const newTiers = [...tiers];
        newTiers[index][field] = value;
        setTiers(newTiers);
    };

    const addTier = () => {
        const newTier = { id: Date.now().toString(), name: 'New Tier', color: 'bg-gray-500', cookieIds: [] };
        setTiers([...tiers, newTier]);
    };

    const removeTier = (index) => {
        const newTiers = tiers.filter((_, i) => i !== index);
        setTiers(newTiers);
    };

    const handleSave = async () => {
        setIsSaving(true);
        await onSave({ ...tierList, tiers });
        setIsSaving(false);
        onCancel();
    };

    const colorOptions = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500', 'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500', 'bg-slate-500'];

    return (
         <div className="bg-slate-800 text-white rounded-2xl shadow-xl w-full max-w-2xl p-6 relative my-8 max-h-[90vh] flex flex-col">
            <button onClick={onCancel} className="absolute top-4 right-4 text-white opacity-70 hover:opacity-100"><Icon path="M6 18L18 6M6 6l12 12" /></button>
            <h2 className="text-3xl font-bold mb-6 text-center">Edit Tiers for {tierList.name}</h2>
            <div className="space-y-4 overflow-y-auto pr-2 flex-grow">
                {tiers.map((tier, index) => (
                    <div key={tier.id} className="flex items-center gap-4 bg-slate-700/50 p-3 rounded-lg">
                        <input type="text" value={tier.name} onChange={e => handleTierChange(index, 'name', e.target.value)} className="w-32 px-2 py-1 bg-slate-900 rounded-md border border-slate-600"/>
                        <div className="flex-1 flex flex-wrap gap-2">
                            {colorOptions.map(color => (
                                <button key={color} onClick={() => handleTierChange(index, 'color', color)} className={`w-8 h-8 rounded-full ${color} ${tier.color === color ? 'ring-2 ring-white' : ''}`}></button>
                            ))}
                        </div>
                        <button onClick={() => removeTier(index)} className="text-red-400 hover:text-red-300"><Icon path="M19 7l-.867 12.143A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.857L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></button>
                    </div>
                ))}
            </div>
            <div className="mt-6 pt-4 border-t border-slate-700">
                <button onClick={addTier} className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold">Add New Tier</button>
                 <div className="flex justify-end pt-4"><button onClick={handleSave} disabled={isSaving} className="px-6 py-2 w-36 bg-green-500 text-white font-bold rounded-full hover:bg-green-600 disabled:bg-green-700 flex items-center justify-center">{isSaving ? 'Saving...' : 'Save'}</button></div>
            </div>
         </div>
    );
}

// --- Main App Component ---
export default function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [cookies, setCookies] = useState([]);
  const [powerUps, setPowerUps] = useState([]);
  const [tierLists, setTierLists] = useState({ pvp: defaultPvpTierList, pve: defaultPveTierList });
  const [attributes, setAttributes] = useState({ rarities: [], roles: [], elements: [], positions: [], costumeRarities: [], powerUpTypes: [] });
  const [view, setView] = useState('list');
  const [sort, setSort] = useState({ option: 'rarity', direction: 'asc' });
  const [modalStack, setModalStack] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [collapsedRarities, setCollapsedRarities] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);
  const [activeAttributeTab, setActiveAttributeTab] = useState('rarities');
  const [searchTerm, setSearchTerm] = useState('');
  const [headerImageUrl, setHeaderImageUrl] = useState('');
  const [isEditingHeader, setIsEditingHeader] = useState(false);

  const themeColors = useImageColors(headerImageUrl);
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

  // Effect to load the ColorThief script
  useEffect(() => {
    const colorThiefScriptId = 'color-thief-script';
    if (!document.getElementById(colorThiefScriptId)) {
        const script = document.createElement('script');
        script.id = colorThiefScriptId;
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/color-thief/2.3.0/color-thief.umd.js";
        script.async = true;
        document.head.appendChild(script);
    }
  }, []);

  // Effect for Firebase Initialization and Authentication
  useEffect(() => {
    try {
        if (typeof __firebase_config !== 'undefined') {
            const firebaseConfig = JSON.parse(__firebase_config);
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (!user) {
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                        } else {
                            await signInAnonymously(firebaseAuth);
                        }
                    } catch (error) {
                        console.error("Firebase Auth Error:", error);
                        await signInAnonymously(firebaseAuth);
                    }
                }
            });
            return () => unsubscribe();
        }
    } catch(e) {
        console.error("Firebase initialization failed:", e);
    }
  }, []);

  // Effect for setting up Firestore data listeners
  useEffect(() => {
    if (!db) return;

    const collections = {
      cookies: `artifacts/${appId}/public/data/cookies`,
      powerups: `artifacts/${appId}/public/data/powerups`,
      tierlists: `artifacts/${appId}/public/data/tierlists`,
      rarities: `artifacts/${appId}/public/data/rarities`,
      costumeRarities: `artifacts/${appId}/public/data/costumeRarities`,
      powerUpTypes: `artifacts/${appId}/public/data/powerUpTypes`,
      roles: `artifacts/${appId}/public/data/roles`,
      elements: `artifacts/${appId}/public/data/elements`,
      positions: `artifacts/${appId}/public/data/positions`,
    };

    const unsubscribes = Object.entries(collections).map(([key, path]) =>
      onSnapshot(query(collection(db, path)), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (key === 'cookies') setCookies(data.length > 0 ? data : [defaultCookie]);
        else if (key === 'powerups') setPowerUps(data);
        else if (key === 'tierlists') {
            const pvpData = data.find(d => d.id === 'pvp-tier-list') || defaultPvpTierList;
            const pveData = data.find(d => d.id === 'pve-tier-list') || defaultPveTierList;

            // Backwards compatibility for old object-based tier structure
            if (!Array.isArray(pvpData.tiers)) pvpData.tiers = defaultTiers;
            if (!Array.isArray(pveData.tiers)) pveData.tiers = defaultTiers;

            setTierLists({ pvp: pvpData, pve: pveData });
        }
        else {
            data.sort((a, b) => (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0) - (b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0));
            setAttributes(prev => ({ ...prev, [key]: data }));
        }
      }, (error) => console.error(`Failed to fetch ${key}:`, error))
    );

    const settingsDocRef = doc(db, `artifacts/${appId}/public/data/settings`, 'wiki-theme');
    const unsubSettings = onSnapshot(settingsDocRef, (docSnap) => {
        setHeaderImageUrl(docSnap.exists() ? docSnap.data().headerImageUrl : 'https://static.wikia.nocookie.net/cookierunkingdom/images/9/96/Cutscene_common_background_1.png/revision/latest');
    });
    unsubscribes.push(unsubSettings);

    return () => unsubscribes.forEach(unsub => unsub());
  }, [db, appId]);

  // --- Data Processing (Memoized for performance) ---
  const filteredCookies = useMemo(() => cookies.filter(cookie =>
    cookie.name.toLowerCase().includes(searchTerm.toLowerCase())
  ), [cookies, searchTerm]);

  const sortedCookies = useMemo(() => [...filteredCookies].sort((a, b) => {
    let comparison = 0;
    if (sort.option === 'rarity') {
      const rarityOrder = attributes.rarities.map(r => r.name);
      comparison = (rarityOrder.indexOf(a.rarity) ?? Infinity) - (rarityOrder.indexOf(b.rarity) ?? Infinity);
      if (comparison === 0) {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        comparison = timeA - timeB;
      }
    } else {
      comparison = a.name.localeCompare(b.name);
    }
    return sort.direction === 'asc' ? comparison : -comparison;
  }), [filteredCookies, sort, attributes.rarities]);

  const groupedCookies = useMemo(() => sortedCookies.reduce((acc, cookie) => {
    const rarity = cookie.rarity || 'Common';
    (acc[rarity] = acc[rarity] || []).push(cookie);
    return acc;
  }, {}), [sortedCookies]);

  const cookieTiersMap = useMemo(() => {
    const map = {};
    const processTierList = (tierList, type) => {
      if (tierList && tierList.tiers) {
        tierList.tiers.forEach(tier => {
          tier.cookieIds.forEach(id => {
            if (!map[id]) map[id] = {};
            map[id][type] = tier.name;
          });
        });
      }
    };
    processTierList(tierLists.pvp, 'pvp');
    processTierList(tierLists.pve, 'pve');
    return map;
  }, [tierLists]);

  // --- Handlers ---
  const handleSort = (option) => {
    setSort(prev => ({
      option,
      direction: prev.option === option && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const saveData = async (collectionName, data, id) => {
     if (!db) return null;
     try {
        const path = `artifacts/${appId}/public/data/${collectionName}`;
        const collectionRef = collection(db, path);

        if (id) {
            await setDoc(doc(collectionRef, id), data, { merge: true });
            return id;
        } else {
            const docRef = await addDoc(collectionRef, data);
            return docRef.id;
        }
    } catch (e) {
        console.error(`Error saving ${collectionName}:`, e);
        return null;
    }
  }

  const handleSaveCookie = async (cookieData, id) => {
    const dataToSave = { ...cookieData };
    if (!id) dataToSave.createdAt = serverTimestamp();
    await saveData('cookies', dataToSave, id);
    closeModal();
  };

  const handleSaveCostume = async (costumeData, cookieId) => {
      const cookieDoc = cookies.find(c => c.id === cookieId);
      if (!cookieDoc) return;

      const existingCostumes = cookieDoc.costumes || [];
      const costumeIndex = existingCostumes.findIndex(c => c.name === costumeData.originalName);

      let updatedCostumes;
      const restOfCostumeData = { ...costumeData };
      delete restOfCostumeData.originalName;

      if (costumeIndex > -1) {
          updatedCostumes = [...existingCostumes];
          updatedCostumes[costumeIndex] = restOfCostumeData;
      } else {
          updatedCostumes = [...existingCostumes, restOfCostumeData];
      }

      await saveData('cookies', {...cookieDoc, costumes: updatedCostumes}, cookieId);
      closeModal();
  }

  const handleSavePowerUp = async (powerUpData, id) => {
    const dataToSave = { ...powerUpData };
    if (!id) dataToSave.createdAt = serverTimestamp();
    await saveData('powerups', dataToSave, id);
    closeModal();
  }

  const handleSaveTierList = async (newList) => {
      await saveData('tierlists', newList, newList.id);
  }

  const handleDelete = (collectionName, id) => {
    setConfirmAction({
        message: `Are you sure you want to delete this item? This action cannot be undone.`,
        action: async () => {
            if (!db) return;
            try {
                if (collectionName === 'cookies') {
                    // Remove cookie from both tier lists
                    const { pvp, pve } = tierLists;
                    let pvpChanged = false;
                    let pveChanged = false

                    const newPvpTiers = pvp.tiers.map(t => ({...t, cookieIds: t.cookieIds.filter(cookieId => cookieId !== id)}));
                    if(JSON.stringify(newPvpTiers) !== JSON.stringify(pvp.tiers)) pvpChanged = true;
                    if (pvpChanged) await handleSaveTierList({ ...pvp, tiers: newPvpTiers });

                    const newPveTiers = pve.tiers.map(t => ({...t, cookieIds: t.cookieIds.filter(cookieId => cookieId !== id)}));
                    if(JSON.stringify(newPveTiers) !== JSON.stringify(pve.tiers)) pveChanged = true;
                    if (pveChanged) await handleSaveTierList({ ...pve, tiers: newPveTiers });
                }

                if (collectionName === 'powerups') {
                    const linkedCookie = cookies.find(c => c.powerUpId === id);
                    if (linkedCookie) {
                        await saveData('cookies', { ...linkedCookie, powerUpId: '' }, linkedCookie.id);
                    }
                }

                await deleteDoc(doc(db, `artifacts/${appId}/public/data/${collectionName}`, id));
                closeModal();
            } catch (e) { console.error(`Error deleting from ${collectionName}:`, e); }
        }
    });
  };

  const handleDeleteCostume = (costumeToDelete) => {
    setConfirmAction({
        message: `Are you sure you want to delete the costume "${costumeToDelete.name}"?`,
        action: async () => {
            const parentCookie = cookies.find(c => c.id === costumeToDelete.cookie.id);
            if (!parentCookie) return;
            const updatedCostumes = (parentCookie.costumes || []).filter(c => c.name !== costumeToDelete.name);
            await saveData('cookies', { ...parentCookie, costumes: updatedCostumes }, parentCookie.id);
            closeModal();
        }
    });
  };

  const handleSaveAttribute = async (type, data, id) => {
    await saveData(type, data, id);
  };

  const handleDeleteAttribute = (type, id) => {
    setConfirmAction({
        message: `Are you sure you want to delete this attribute?`,
        action: async () => { if (db) await deleteDoc(doc(db, `artifacts/${appId}/public/data/${type}`, id)); }
    });
  };

  const handleHeaderUpdate = async () => {
    if (db) await setDoc(doc(db, `artifacts/${appId}/public/data/settings`, 'wiki-theme'), { headerImageUrl }, { merge: true });
    setIsEditingHeader(false);
  };

  const openModal = (type, data = null) => setModalStack(prev => [...prev, { type, data }]);
  const closeModal = () => setModalStack(prev => prev.slice(0, -1));

  const getAttributeImageUrl = (type, name) => {
    const listKeyMap = { rarity: 'rarities', costumeRarity: 'costumeRarities', role: 'roles', element: 'elements', position: 'positions', powerUpType: 'powerUpTypes' };
    const list = attributes[listKeyMap[type]] || [];
    return list.find(a => a.name === name)?.imageUrl;
  };

  if (!db || !auth) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-slate-900 text-white">
        <img src={proxifyUrl("https://static.wikia.nocookie.net/cookierunkingdom/images/1/1c/Cookie0000_emotion-die.gif/revision/latest")} alt="Loading..." className="w-32 h-32" />
        <p className="mt-4 text-lg font-semibold">Connecting to the Oven...</p>
      </div>
    );
  }

  const currentModal = modalStack[modalStack.length - 1];
  const { type: modalType, data: modalData } = currentModal || {};

  const MainContent = () => {
    switch(view) {
        case 'list':
            return <CookieListView searchTerm={searchTerm} setSearchTerm={setSearchTerm} sort={sort} onSort={handleSort} groupedCookies={groupedCookies} sortedCookies={sortedCookies} collapsedRarities={collapsedRarities} setCollapsedRarities={setCollapsedRarities} getAttributeImageUrl={getAttributeImageUrl} onCardClick={openModal} />;
        case 'attributes':
            return <AttributeManager attributes={attributes} onSave={handleSaveAttribute} onDelete={handleDeleteAttribute} activeTab={activeAttributeTab} setActiveTab={setActiveAttributeTab} />;
        case 'costumes':
            return <CostumeManagerView cookies={cookies} getAttributeImageUrl={getAttributeImageUrl} onCostumeClick={(costume) => openModal('costumeDetail', costume)} attributes={attributes} />;
        case 'powerups':
            return <PowerUpManagerView powerUps={powerUps} cookies={cookies} attributes={attributes} onCardClick={openModal} />
        case 'tierlist':
            return <TierListView cookies={cookies} tierLists={tierLists} onSave={handleSaveTierList} attributes={attributes} openModal={openModal} />
        default:
            return null;
    }
  }

  return (
    <div className="bg-[var(--color-background)] min-h-screen text-[var(--color-text)] font-sans flex font-poppins leading-relaxed">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap');
        :root {
            --color-primary: ${themeColors?.primary || '#ec4899'}; --color-accent: ${themeColors?.accent || '#db2777'};
            --color-text: ${themeColors?.text || '#ffffff'}; --color-background: ${themeColors?.background || '#0f172a'};
            --color-highlight: ${themeColors?.highlight || '#f59e0b'};
        }
        body { background-color: var(--color-background); } .font-poppins { font-family: 'Poppins', sans-serif; }
        .header-bg {
            position: absolute; top: 0; left: 0; right: 0; height: 50vh; background-image: url('${proxifyUrl(headerImageUrl)}');
            background-size: cover; background-position: center; opacity: 0.4;
            mask-image: linear-gradient(to bottom, black 50%, transparent 100%); z-index: 0; pointer-events: none;
        }
        main { position: relative; z-index: 1; } ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1e293b; } ::-webkit-scrollbar-thumb { background: var(--color-primary); border-radius: 10px; }
      `}</style>
      <Sidebar currentView={view} isSidebarOpen={isSidebarOpen} setView={setView} setIsSidebarOpen={setIsSidebarOpen} />
      <div className="flex-grow overflow-y-auto relative">
        <div className="header-bg"></div>
        <div className="absolute top-4 right-4 z-10">
            <button onClick={() => setIsEditingHeader(!isEditingHeader)} className="p-2 bg-slate-800/50 rounded-full hover:bg-slate-700/70 transition-colors"><Icon path="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 19.82a2.25 2.25 0 01-1.06.58L3.75 21l.663-2.75a2.25 2.25 0 01.58-1.06l11.872-11.872zM15.75 5.25l2.25 2.25" className="w-5 h-5"/></button>
            {isEditingHeader && (<input type="text" value={headerImageUrl} onChange={(e) => setHeaderImageUrl(e.target.value)} onBlur={handleHeaderUpdate} onKeyDown={(e) => { if (e.key === 'Enter') handleHeaderUpdate(); }} className="absolute top-full right-0 mt-2 w-72 bg-slate-800 text-white p-2 rounded-md shadow-lg border border-slate-600" placeholder="Enter new header image URL" autoFocus />)}
        </div>
        <main className="p-4 md:p-8"><MainContent /></main>
      </div>

      {currentModal && (
          <ModalWrapper onClose={closeModal}>
            {modalType === 'detail' && (<CookieDetail cookie={modalData} allCookies={cookies} powerUp={powerUps.find(p => p.id === modalData.powerUpId)} cookieTiers={cookieTiersMap[modalData.id]} onClose={closeModal} onEdit={(cookie) => openModal('form', cookie)} onDelete={(id) => handleDelete('cookies', id)} onCostumeClick={(costume) => openModal('costumeDetail', { ...costume, cookie: modalData })} getAttributeImageUrl={getAttributeImageUrl}/>)}
            {modalType === 'form' && (<CookieForm cookie={modalData} onSave={handleSaveCookie} onCancel={closeModal} attributes={attributes} powerUps={powerUps} onEditCostume={(costume) => openModal('costumeForm', { ...costume, cookie: modalData, originalName: costume.name })}/>)}
            {modalType === 'costumeDetail' && (<CostumeDetail costume={modalData} onClose={closeModal} onEdit={(costume) => openModal('costumeForm', { ...costume, originalName: costume.name })} onDelete={handleDeleteCostume} />)}
            {modalType === 'costumeForm' && (<CostumeForm costume={modalData} onSave={handleSaveCostume} onCancel={closeModal} attributes={attributes} />)}
            {modalType === 'powerUpDetail' && <PowerUpDetail powerUp={modalData} allCookies={cookies} onClose={closeModal} onEdit={(powerUp) => openModal('powerUpForm', powerUp)} onDelete={(id) => handleDelete('powerups', id)} />}
            {modalType === 'powerUpForm' && <PowerUpForm powerUp={modalData} onSave={handleSavePowerUp} onCancel={closeModal} attributes={attributes} />}
            {modalType === 'tierEditor' && <TierEditorModal tierList={modalData.tierList} onSave={modalData.onSave} onCancel={closeModal} />}
          </ModalWrapper>
      )}

      {confirmAction && (<ConfirmDialog message={confirmAction.message} onConfirm={() => { confirmAction.action(); setConfirmAction(null); }} onCancel={() => setConfirmAction(null)}/>)}

      {view === 'list' && (<button onClick={() => openModal('form')} className="fixed bottom-8 right-8 bg-green-500 text-white p-4 rounded-full shadow-lg hover:bg-green-600 transition-transform hover:scale-110 duration-300 z-30" aria-label="Add New Cookie"><Icon path="M12 4v16m8-8H4" /></button>)}
      {view === 'powerups' && (<button onClick={() => openModal('powerUpForm')} className="fixed bottom-8 right-8 bg-purple-500 text-white p-4 rounded-full shadow-lg hover:bg-purple-600 transition-transform hover:scale-110 duration-300 z-30" aria-label="Add New Power-up"><Icon path="M12 4v16m8-8H4" /></button>)}
    </div>
  );
}