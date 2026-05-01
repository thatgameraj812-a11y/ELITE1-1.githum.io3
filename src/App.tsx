/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { ShoppingCart, LogIn, LogOut, Menu, X, Search, ChevronRight, MessageCircle, Settings, User as UserIcon, Star, ShoppingBag, Trash2, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BlurredText } from './components/BlurredText';
import { auth, googleProvider, db } from './lib/firebase';
import { BANNED_BRANDS } from './components/BlurredText';
import { cn, formatPrice } from './lib/utils';
import { collection, query, getDocs, onSnapshot, doc, getDoc, setDoc, deleteDoc, addDoc } from 'firebase/firestore';

// --- Types ---
interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  salePrice?: number;
  stock: number;
  images: string[];
  pdfUrl?: string;
  category: string;
  shopUrl?: string;
  cashAppUrl?: string;
  sizes?: string[];
  colors?: string[];
}

interface HomeSection {
  id: string;
  title: string;
  subtitle: string;
  categories: string[];
  order: number;
}

interface CartItem extends Product {
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  isSigningIn: boolean;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}

interface ShippingInfo {
  fullName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumber: string;
  specialInstructions?: string;
}

interface ShippingRequest {
    id: string;
    email: string;
    orderType: string;
    cartItems: any[];
    total: number;
    createdAt?: string;
    shippingInfo?: ShippingInfo;
}

// --- Helper Components ---
const ProductImage = ({ src, alt, className, product, imgClassName }: { src: string; alt?: string; className?: string; product: Product; imgClassName?: string }) => {
  const needsBlur = BANNED_BRANDS.some(brand => {
    const b = brand.toLowerCase();
    return (
      product.name?.toLowerCase().includes(b) || 
      product.category?.toLowerCase().includes(b) ||
      product.description?.toLowerCase().includes(b)
    );
  }) || product.category?.toLowerCase().includes('cologne') || product.name?.toLowerCase().includes('baka');

  return (
    <div className={cn("relative w-full h-full noise-overlay", className)}>
      <img 
        src={src} 
        alt={alt} 
        className={cn("w-full h-full object-cover transition-all duration-500", imgClassName)}
        referrerPolicy="no-referrer"
      />
      {needsBlur && (
        <div 
          className="absolute inset-x-0 bg-black/60 backdrop-blur-3xl pointer-events-none border-y border-white/20" 
          style={{
            top: '48%',
            height: '22%',
            transform: 'translateY(-50%)',
          }}
        >
           <div className="w-full h-full flex items-center justify-center">
              <span className="text-[10px] font-black uppercase text-white/10 tracking-[0.3em]">REDACTED</span>
           </div>
        </div>
      )}
    </div>
  );
};

// --- Contexts ---
const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Components ---
const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const addToCart = (product: Product, selectedSize?: string, selectedColor?: string) => {
    setCart(prev => {
      const existing = prev.find(item => 
        item.id === product.id && 
        item.selectedSize === selectedSize && 
        item.selectedColor === selectedColor
      );
      if (existing) {
        return prev.map(item => 
          (item.id === product.id && item.selectedSize === selectedSize && item.selectedColor === selectedColor) 
            ? { ...item, quantity: item.quantity + 1 } 
            : item
        );
      }
      return [...prev, { ...product, quantity: 1, selectedSize, selectedColor }];
    });
  };

  const removeFromCart = (id: string, selectedSize?: string, selectedColor?: string) => {
    setCart(prev => prev.filter(item => 
      !(item.id === id && item.selectedSize === selectedSize && item.selectedColor === selectedColor)
    ));
  };

  const clearCart = () => setCart([]);

  const total = cart.reduce((acc, item) => acc + (item.salePrice || item.price) * item.quantity, 0);

  return (
    <CartContext.Provider value={{ 
      cart, 
      addToCart, 
      removeFromCart, 
      clearCart, 
      total, 
      isCartOpen, 
      setIsCartOpen
    }}>
      {children}
    </CartContext.Provider>
  );
};

const CartContext = createContext<{
  cart: CartItem[];
  addToCart: (p: Product, size?: string, color?: string) => void;
  removeFromCart: (id: string, size?: string, color?: string) => void;
  clearCart: () => void;
  total: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
} | null>(null);

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Sync user to firestore and check admin status
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        if (!userDoc.exists()) {
          const defaultAdmin = 'thatgameraj812@gmail.com';
          const envAdmin = import.meta.env.VITE_ADMIN_EMAIL;
          const isUserAdmin = u.email === defaultAdmin || (envAdmin && u.email === envAdmin);
          
          await setDoc(doc(db, 'users', u.uid), {
            email: u.email,
            isAdmin: isUserAdmin,
            createdAt: new Date().toISOString()
          });
          setIsAdmin(isUserAdmin);
        } else {
          const defaultAdmin = 'thatgameraj812@gmail.com';
          const envAdmin = import.meta.env.VITE_ADMIN_EMAIL;
          const isUserAdmin = userDoc.data().isAdmin || u.email === defaultAdmin || (envAdmin && u.email === envAdmin);
          setIsAdmin(isUserAdmin);
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
  }, []);

  const signIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Auth error", error);
      if (error.code === 'auth/popup-blocked') {
        alert("Sign-in popup was blocked by your browser. Please allow popups for this site and try again.");
      } else {
        alert("Authentication failed: " + error.message);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, isSigningIn, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// --- Pages ---

// 1. Home Page
const HomePage = ({ whatsappLink }: { whatsappLink: string }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const productsQ = collection(db, 'products');
    const sectionsQ = collection(db, 'home_sections');

    const unsubProducts = onSnapshot(productsQ, (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });

    const unsubSections = onSnapshot(sectionsQ, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HomeSection));
      setSections(items.sort((a, b) => a.order - b.order));
      setLoading(false);
    });

    return () => {
      unsubProducts();
      unsubSections();
    };
  }, []);

  return (
    <div className="space-y-32 pb-20 bg-black">
      {/* Hero */}
      <section className="relative h-[85vh] flex items-center justify-center overflow-hidden bg-black">
        <div className="absolute inset-0 bg-black" />
        <div className="absolute inset-0 bg-linear-to-b from-purple-900/20 to-black" />
        <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
        
        <div className="relative z-10 text-center space-y-8 px-4 max-w-5xl mx-auto">
          <motion.h1 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-6xl md:text-[11rem] font-black text-white tracking-tighter uppercase italic leading-[0.8] mb-4 drop-shadow-[0_0_30px_rgba(124,58,237,0.3)]"
          >
            Elite 1:1
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-2xl text-purple-200/60 max-w-2xl mx-auto font-light uppercase tracking-[0.4em] leading-relaxed"
          >
            Premium Archives & Exclusive Sourcing
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="pt-8"
          >
            <Link to="/shop" className="inline-block bg-purple-600 text-white px-12 py-5 rounded-full font-black hover:bg-purple-700 hover:scale-105 transition-all uppercase tracking-widest text-sm shadow-[0_0_50px_rgba(124,58,237,0.4)]">
              Explore Collection
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Main Spots */}
      <div className="container mx-auto px-6 space-y-32">
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[1, 2, 3, 4].map(i => <div key={i} className="aspect-[3/4] bg-white/5 animate-pulse rounded-lg" />)}
          </div>
        ) : (
          <>
            {sections.length > 0 ? (
              sections.map(section => {
                const sectionProducts = products.filter(p => section.categories.includes(p.category)).slice(0, 8);
                if (sectionProducts.length === 0) return null;

                return (
                  <section key={section.id} className="space-y-12">
                    <div className="flex flex-col md:flex-row justify-between items-center md:items-end border-b-4 border-purple-600 pb-8 gap-4">
                      <div className="space-y-2 text-center md:text-left">
                        <h2 className="text-6xl md:text-8xl font-black uppercase italic tracking-tighter leading-none text-white">
                          <BlurredText text={section.title} />
                        </h2>
                        <p className="text-sm text-purple-400 font-bold uppercase tracking-[0.5em]">
                          <BlurredText text={section.subtitle} />
                        </p>
                      </div>
                      <Link to="/shop" className="bg-purple-600 text-white px-8 py-3 rounded-full text-xs font-black uppercase tracking-widest hover:bg-purple-700 transition-colors flex items-center gap-2 group shadow-xl shadow-purple-500/20">
                        View All <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-16">
                      {sectionProducts.map(product => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  </section>
                );
              })
            ) : (
              <div className="text-center py-32 bg-white/5 rounded-[3rem] border-2 border-dashed border-white/10 backdrop-blur-sm">
                 <ShoppingBag size={64} className="mx-auto text-zinc-700 mb-6" />
                 <p className="text-zinc-500 text-xl font-black uppercase tracking-widest italic">Setup your home sections in Admin Settings.</p>
                 <p className="text-zinc-500 text-sm uppercase tracking-widest mt-2">The vault is currently awaiting configuration.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* WhatsApp Support CTA */}
      <section className="bg-black text-white py-24 relative overflow-hidden border-y border-white/5">
        <div className="absolute top-0 right-0 w-64 h-64 bg-green-600/10 blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-green-600/10 blur-[100px]" />
        <div className="container mx-auto px-6 text-center space-y-8 relative z-10">
          <h2 className="text-5xl md:text-6xl font-black tracking-tighter uppercase italic leading-none">Need Any Help?</h2>
          <p className="text-zinc-400 max-w-xl mx-auto text-lg leading-relaxed font-medium">
            Contact us directly on WhatsApp for exclusive sourcing, bulk orders, or custom 1:1 requests.
          </p>
          <div 
            className="inline-flex items-center gap-3 bg-[#25D366] text-white px-10 py-5 rounded-full font-black uppercase tracking-widest text-sm shadow-xl shadow-green-500/20"
          >
            <MessageCircle size={20} />
            Contact: 689-312-4370
          </div>
        </div>
      </section>
    </div>
  );
};

const ProductCard = ({ product }: { product: Product, key?: any }) => {
  const { addToCart, setIsCartOpen } = useCart();

  return (
    <div className="group block relative">
      <Link to={`/product/${product.id}`}>
        <div className="aspect-[3/4] relative overflow-hidden bg-zinc-950 rounded-2xl mb-4 group/img shadow-2xl">
          <ProductImage 
            src={product.images[0] || "https://picsum.photos/seed/apparel/600/800"} 
            alt={product.name}
            product={product}
            imgClassName="transition-all duration-700 group-hover:scale-110 opacity-90 group-hover:opacity-100"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-60 group-hover/img:opacity-20 transition-opacity" />
          
          <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
            <div className="bg-white/10 backdrop-blur-md text-white text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 rounded border border-white/20 shadow-xl">
              Elite
            </div>
            {product.salePrice && (
              <div className="bg-purple-600 text-white text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded shadow-lg">
                Sale
              </div>
            )}
          </div>

          {product.stock === 0 && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold uppercase tracking-[0.2em]">
              Out of Stock
            </div>
          )}
        </div>
      </Link>
      
      {/* Quick Buy Overlay/Button */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            addToCart(product);
            setIsCartOpen(true);
          }}
          className="p-3 bg-white text-black rounded-full shadow-lg hover:bg-black hover:text-white transition-all flex items-center justify-center"
          title="Add to Cart"
        >
          <ShoppingBag size={18} />
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-xs text-purple-400 uppercase tracking-widest">
           <BlurredText text={product.category} />
        </p>
        <Link to={`/product/${product.id}`}>
          <h3 className="font-bold text-white leading-tight hover:underline">
            <BlurredText text={product.name} />
          </h3>
        </Link>
        <div className="flex items-center gap-2">
          {product.salePrice ? (
            <>
              <span className="text-white font-bold">{formatPrice(product.salePrice)}</span>
              <span className="text-purple-400/50 line-through text-sm">{formatPrice(product.price)}</span>
            </>
          ) : (
            <span className="text-white font-bold">{formatPrice(product.price)}</span>
          )}
        </div>
      </div>
    </div>
  );
};

// 2. Shop Page
const ShopPage = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const activeCategory = searchParams.get('category') || '';

  useEffect(() => {
    const q = collection(db, 'products');
    setLoading(true);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(items);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const categories = Array.from(new Set(products.map(p => p.category))).filter(Boolean) as string[];

  const filtered = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || 
                         p.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory ? p.category === activeCategory : true;
    return matchesSearch && matchesCategory;
  });

  const setCategory = (cat: string) => {
    if (cat === activeCategory) {
      navigate('/shop');
    } else {
      navigate(`/shop?category=${cat}`);
    }
  };

  return (
    <div className="container mx-auto px-6 py-10 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-6">
        <div>
          <h1 className="text-4xl font-black uppercase italic tracking-tighter text-white">Inventory</h1>
          <p className="text-purple-400 text-sm font-bold uppercase tracking-widest">{filtered.length} ARCHIVED PIECES</p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
          <input 
            type="text" 
            placeholder="SEARCH OUR ARCHIVES..." 
            className="w-full bg-white/5 border border-white/10 rounded-full py-3 pl-12 pr-6 text-sm focus:ring-2 focus:ring-purple-600 outline-none uppercase tracking-widest placeholder:text-zinc-500 font-bold text-white backdrop-blur-md"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Category Pills */}
            <div className="flex flex-wrap gap-2 mb-12">
        <button 
          onClick={() => navigate('/shop')}
          className={cn(
            "px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
            !activeCategory ? "bg-purple-600 text-white shadow-lg" : "bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10"
          )}
        >
          All Pieces
        </button>
        {categories.map(cat => (
          <button 
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
              activeCategory === cat ? "bg-purple-600 text-white shadow-lg" : "bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10"
            )}
          >
            <BlurredText text={cat} />
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-4">
              <div className="aspect-[3/4] bg-white/5 animate-pulse rounded-lg" />
              <div className="h-4 w-3/4 bg-white/5 animate-pulse rounded" />
              <div className="h-4 w-1/2 bg-white/5 animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {filtered.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-20 text-center space-y-4 bg-white/5 rounded-3xl border-2 border-dashed border-white/10">
               <Search size={48} className="mx-auto text-zinc-700 mb-4" />
               <p className="text-zinc-400 uppercase tracking-widest text-sm font-bold">No items matching your selection</p>
               <button 
                 onClick={() => { setSearch(''); navigate('/shop'); }} 
                 className="text-purple-500 font-black underline uppercase tracking-widest text-xs hover:text-purple-400"
               >
                 Reset Search & Filters
               </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 3. Product Detail Page
const ProductDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { user, signIn, isAdmin } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState<any[]>([]);
  const { addToCart, setIsCartOpen } = useCart();
  const [activeImage, setActiveImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [globalCashApp, setGlobalCashApp] = useState('');
  const [whatsappLink, setWhatsappLink] = useState('https://wa.me/16893124370');
  const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const docRef = doc(db, 'products', id);
    const unsubProduct = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Product;
        setProduct({ id: snap.id, ...data } as Product);
        setNotFound(false);
        if (data.sizes && data.sizes.length > 0 && !selectedSize) setSelectedSize(data.sizes[0]);
        if (data.colors && data.colors.length > 0 && !selectedColor) setSelectedColor(data.colors[0]);
      } else {
        setProduct(null);
        setNotFound(true);
      }
    });

    // Sub to global settings
    const settingsUnsub = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
        if (snap.exists()) {
          setGlobalCashApp(snap.data().cashAppUrl || '');
          setWhatsappLink(snap.data().whatsappLink || 'https://wa.me/16893124370');
        }
    });

    // Sub to reviews
    const reviewsRef = collection(db, 'products', id, 'reviews');
    const reviewsUnsub = onSnapshot(reviewsRef, (snap) => {
      setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => {
        unsubProduct();
        settingsUnsub();
        reviewsUnsub();
    };
  }, [id]);

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-white bg-black p-6">
      <h2 className="text-4xl font-black uppercase italic tracking-tighter mb-4">Piece Not Found</h2>
      <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-8">This item may have been removed or sold out.</p>
      <Link to="/shop" className="bg-purple-600 text-white px-8 py-3 rounded-full font-black uppercase tracking-widest text-xs hover:bg-purple-700 transition-all">
        Back to Archives
      </Link>
    </div>
  );

  if (!product) return <div className="min-h-screen flex items-center justify-center text-white bg-black">
    <div className="flex flex-col items-center gap-4">
      <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Retrieving Piece...</span>
    </div>
  </div>;

  const cashAppUrlToUse = product.cashAppUrl || globalCashApp || "$2footmike";
  const finalCashAppUrl = cashAppUrlToUse.startsWith('$') ? `https://cash.app/${cashAppUrlToUse}` : cashAppUrlToUse;

  const handleBuyNowFromDetail = async (method: 'shop' | 'cashapp') => {
    if (product.sizes?.length && !selectedSize) {
        alert("Please select a size first.");
        return;
    }
    if (product.colors?.length && !selectedColor) {
        alert("Please select a color first.");
        return;
    }

    if (method === 'cashapp') {
        setIsShippingModalOpen(true);
    } else {
        addToCart(product, selectedSize, selectedColor);
        setIsCartOpen(true);
    }
  };

  const handleShippingComplete = async (shippingInfo: ShippingInfo) => {
    if (!product) return;
    setIsShippingModalOpen(false);
    try {
        await addDoc(collection(db, 'shipping_requests'), {
            email: user?.email || 'Guest',
            orderType: 'CASHAPP',
            cartItems: [{
                id: product.id,
                name: product.name,
                size: selectedSize || 'N/A',
                color: selectedColor || 'N/A',
                price: product.salePrice || product.price
            }],
            total: product.salePrice || product.price,
            shippingInfo,
            createdAt: new Date().toISOString()
        });
        window.open(finalCashAppUrl, '_blank');
    } catch (err) {
        console.error("Direct checkout error:", err);
        window.open(finalCashAppUrl, '_blank');
    }
  };

  return (
    <div className="container mx-auto px-6 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
        {/* Images */}
        <div className="space-y-6">
          <div className="aspect-[3/4] bg-zinc-950 rounded-[2.5rem] overflow-hidden shadow-2xl group/hero relative">
            <ProductImage 
              src={product.images[activeImage] || "https://picsum.photos/seed/apparel/600/800"} 
              product={product}
              alt={product.name}
              imgClassName="transition-all duration-1000 group-hover/hero:scale-110"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none opacity-60" />
            <div className="absolute bottom-6 left-6 flex gap-2">
                <span className="bg-white/10 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-[0.2em] px-4 py-2 rounded-full border border-white/20 shadow-xl">Elite Verified</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 px-2">
            {product.images.map((img, i) => (
              <button 
                key={i} 
                onClick={() => setActiveImage(i)}
                className={cn(
                  "aspect-[3/4] rounded-2xl overflow-hidden border-2 transition-all bg-zinc-900 shadow-lg relative",
                  activeImage === i ? "border-purple-500 scale-95 shadow-purple-500/20" : "border-transparent opacity-40 hover:opacity-100"
                )}
              >
                <ProductImage 
                  src={img} 
                  product={product}
                  imgClassName="transition-all duration-500" 
                />
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="space-y-8">
          <div className="space-y-2">
            <p className="text-purple-400 uppercase tracking-widest text-xs font-black">
              <BlurredText text={product.category} />
            </p>
            <h1 className="text-5xl font-black uppercase italic tracking-tighter leading-none text-white">
              <BlurredText text={product.name} />
            </h1>
            <div className="flex items-center gap-4 text-2xl font-bold mt-4">
              {product.salePrice ? (
                <>
                  <span className="text-white font-black">{formatPrice(product.salePrice)}</span>
                  <span className="text-purple-400/40 line-through font-light">{formatPrice(product.price)}</span>
                </>
              ) : (
                <span className="text-white font-black">{formatPrice(product.price)}</span>
              )}
            </div>
          </div>

          <div className="prose prose-invert max-w-none">
            <p className="text-zinc-300 font-medium leading-relaxed">
              <BlurredText text={product.description} />
            </p>
          </div>

          {(product.pdfUrl || (product as any).graphicUrl) && (
             <div className="flex flex-wrap gap-3 pt-2">
                {product.pdfUrl && (
                   <a 
                     href={product.pdfUrl} 
                     target="_blank" 
                     rel="noopener noreferrer"
                     className="inline-flex items-center gap-2 bg-white/5 border border-white/10 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-purple-400 hover:bg-white/10 transition-all shadow-lg"
                   >
                     <FileText size={16} />
                     View Specs / PDF
                   </a>
                )}
                {(product as any).graphicUrl && (
                   <a 
                     href={(product as any).graphicUrl} 
                     target="_blank" 
                     rel="noopener noreferrer"
                     className="inline-flex items-center gap-2 bg-white/5 border border-white/10 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-purple-400 hover:bg-white/10 transition-all shadow-lg"
                   >
                     <FileText size={16} className="text-zinc-400" />
                     View PNG Graphic
                   </a>
                )}
             </div>
          )}

          <div className="space-y-6 pt-6 border-t border-white/10">
             {/* Dynamic Options */}
             {product.sizes && product.sizes.length > 0 && (
                <div className="space-y-3">
                   <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Select Size</span>
                      <span className="text-[10px] font-black text-purple-400 hover:text-purple-300 underline cursor-pointer uppercase tracking-widest">Size Guide</span>
                   </div>
                   <div className="flex flex-wrap gap-2">
                      {product.sizes.map(size => (
                         <button 
                            key={size}
                            onClick={() => setSelectedSize(size)}
                            className={cn(
                               "px-4 py-2 border rounded-lg text-xs font-bold transition-all uppercase tracking-widest",
                               selectedSize === size ? "bg-purple-600 text-white border-purple-600 shadow-xl" : "bg-white/5 text-zinc-400 border-white/10 hover:border-purple-500"
                            )}
                         >
                            {size}
                         </button>
                      ))}
                   </div>
                </div>
             )}

             {product.colors && product.colors.length > 0 && (
                <div className="space-y-3">
                   <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Select Color</span>
                   <div className="flex flex-wrap gap-3">
                      {product.colors.map(color => (
                         <button 
                            key={color}
                            onClick={() => setSelectedColor(color)}
                            title={color}
                            className={cn(
                               "w-8 h-8 rounded-full border-2 transition-all p-0.5",
                               selectedColor === color ? "border-purple-500 scale-110 shadow-lg shadow-purple-500/20" : "border-transparent opacity-60 hover:opacity-100"
                            )}
                         >
                            <div className="w-full h-full rounded-full border border-white/10" style={{ backgroundColor: color.toLowerCase() }} />
                         </button>
                      ))}
                   </div>
                </div>
             )}

             <div className="flex flex-col gap-4 pt-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-bold uppercase tracking-widest text-white">Inventory Status</span>
                    <span className={cn(
                      "text-xs font-bold uppercase px-3 py-1 rounded-full",
                      product.stock > 0 ? "bg-white/20 text-white backdrop-blur-sm" : "bg-red-500 text-white"
                    )}>
                      {product.stock > 0 ? `${product.stock} ITEMS REMAINING` : 'OUT OF STOCK'}
                    </span>
                </div>
                
       <div className="grid grid-cols-1 gap-4">
          <button 
            onClick={() => {
                if (product.sizes?.length && !selectedSize) {
                    alert("Please select a size first.");
                    return;
                }
                if (product.colors?.length && !selectedColor) {
                    alert("Please select a color first.");
                    return;
                }
                addToCart(product, selectedSize, selectedColor);
                setIsCartOpen(true);
            }}
            disabled={product.stock === 0}
            className="w-full bg-purple-600 text-white py-4 rounded-full font-black uppercase tracking-widest hover:bg-purple-700 transition-all disabled:opacity-50 shadow-xl shadow-purple-500/10"
          >
            Add to Archive
          </button>
          {cashAppUrlToUse && (
              <button 
                onClick={() => handleBuyNowFromDetail('cashapp')}
                disabled={product.stock === 0}
                className="w-full bg-[#00D632] text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:opacity-90 transition-all disabled:opacity-50 shadow-xl shadow-green-950/40 flex items-center justify-center gap-3"
              >
                Buy Now with CashApp
              </button>
          )}
      </div>
             </div>
          </div>

          {/* Reviews Section */}
          <div className="pt-12 space-y-8">
            <div className="flex items-center justify-between">
               <h3 className="text-2xl font-bold uppercase tracking-tighter italic">Collector Reviews</h3>
               <div className="flex items-center gap-1 text-sm font-bold">
                 <Star size={16} className="fill-purple-500 text-purple-500" />
                 <span>{reviews.length > 0 ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) : '–'}</span>
               </div>
            </div>

            <div className="space-y-6">
              {reviews.map(review => (
                <div key={review.id} className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-3 relative group/review">
                  {isAdmin && (
                    <button 
                      onClick={async () => {
                        try {
                          await deleteDoc(doc(db, 'products', product.id, 'reviews', review.id));
                        } catch (err) {
                          console.error("Failed to delete review", err);
                        }
                      }}
                      className="absolute top-4 right-4 opacity-0 group-hover/review:opacity-100 transition-opacity text-red-500 hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm tracking-tight text-white">{review.userName}</span>
                    <div className="flex gap-0.5">
                       {Array.from({ length: 5 }).map((_, i) => (
                         <Star key={i} size={12} className={cn(i < review.rating ? "fill-purple-500 text-purple-500" : "text-zinc-800")} />
                       ))}
                    </div>
                  </div>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    <BlurredText text={review.comment} />
                  </p>
                </div>
              ))}
              {reviews.length === 0 && <p className="text-zinc-600 text-center italic py-10 uppercase text-xs tracking-widest font-black">Be the first to review this piece.</p>}
            </div>

            {!user ? (
               <button onClick={signIn} className="w-full border-2 border-dashed border-zinc-200 py-6 rounded-2xl text-zinc-400 font-bold uppercase tracking-widest text-xs hover:border-zinc-400 hover:text-zinc-600 transition-all">
                 Login to Leave a Review
               </button>
            ) : (
                <ReviewForm productId={product.id} />
            )}
          </div>
        </div>
      </div>
      <ShippingModal 
        isOpen={isShippingModalOpen} 
        onClose={() => setIsShippingModalOpen(false)} 
        onComplete={handleShippingComplete} 
      />
    </div>
  );
};

const ReviewForm = ({ productId }: { productId: string }) => {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !comment) return;
    setSubmitting(true);
    try {
      await setDoc(doc(collection(db, 'products', productId, 'reviews')), {
        userId: user.uid,
        userName: user.displayName || user.email,
        rating,
        comment,
        createdAt: new Date().toISOString()
      });
      setComment('');
      setRating(5);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-white/5 p-8 rounded-3xl border border-white/10 shadow-2xl backdrop-blur-md">
      <h4 className="font-black uppercase tracking-[0.2em] text-[10px] text-purple-400 italic">Drop your feedback</h4>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map(r => (
          <button type="button" key={r} onClick={() => setRating(r)} className="p-1 group transition-all hover:scale-125">
            <Star className={cn(r <= rating ? "fill-purple-500 text-purple-500" : "text-zinc-700")} size={20} />
          </button>
        ))}
      </div>
      <textarea 
        placeholder="How is the fit? The quality?"
        className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm focus:ring-purple-600 outline-none text-white min-h-[100px] placeholder:text-zinc-600 font-medium"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button 
        disabled={submitting}
        className="w-full bg-purple-600 text-white py-4 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-purple-700 shadow-xl shadow-purple-600/20 disabled:opacity-50 transition-all"
      >
        {submitting ? 'Archiving...' : 'Post Review'}
      </button>
    </form>
  );
};

// 4. Admin Dashboard components
const SectionEditor = ({ section, onSave, onDelete, allCategories, isFirst, isLast, isDeleting }: { 
    section: HomeSection, 
    onSave: (s: Partial<HomeSection>) => Promise<void>, 
    onDelete: (id: string) => Promise<void>,
    allCategories: string[],
    isFirst: boolean,
    isLast: boolean,
    isDeleting: boolean,
    key?: any
}) => {
    const [title, setTitle] = useState(section.title);
    const [subtitle, setSubtitle] = useState(section.subtitle);
    const [cats, setCats] = useState(section.categories);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        await onSave({ id: section.id, title, subtitle, categories: cats });
        setSaving(false);
    };

    const toggleCat = (cat: string) => {
        setCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
    };

    return (
        <div className="bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 p-8 shadow-2xl space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Spot Title</label>
                    <input 
                        type="text" 
                        value={title} 
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-4 font-black uppercase italic text-2xl tracking-tighter focus:ring-2 focus:ring-purple-600 outline-none text-white"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Subheading</label>
                    <input 
                        type="text" 
                        value={subtitle} 
                        onChange={(e) => setSubtitle(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-4 font-bold uppercase tracking-widest text-xs focus:ring-2 focus:ring-purple-600 outline-none text-white"
                    />
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Included Categories</label>
                <div className="flex flex-wrap gap-2">
                    {allCategories.map(cat => (
                        <button 
                            key={cat}
                            onClick={() => toggleCat(cat)}
                            className={cn(
                                "px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all",
                                cats.includes(cat) 
                                    ? "bg-purple-600 text-white border-purple-600 shadow-md" 
                                    : "bg-white/5 text-zinc-400 border-white/10 hover:border-purple-500"
                            )}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>
 
            <div className="flex justify-between items-center pt-4 border-t border-white/10">
                <div className="flex gap-4 items-center">
                    <button 
                        onClick={() => onSave({ id: section.id, order: section.order - 1 })}
                        disabled={isFirst}
                        className="text-[10px] font-black uppercase underline text-zinc-400 hover:text-purple-400 disabled:opacity-30"
                    >
                        Move Up
                    </button>
                    <button 
                        onClick={() => onSave({ id: section.id, order: section.order + 1 })}
                        disabled={isLast}
                        className="text-[10px] font-black uppercase underline text-zinc-400 hover:text-purple-400 disabled:opacity-30"
                    >
                        Move Down
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="ml-4 bg-purple-600 text-white px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50 shadow-xl shadow-purple-500/20"
                    >
                        {saving ? 'Saving...' : 'Update Details'}
                    </button>
                </div>
                <button 
                    onClick={() => onDelete(section.id)}
                    disabled={isDeleting}
                    className="text-[10px] font-black uppercase text-red-500 underline hover:text-red-400 disabled:opacity-50"
                >
                    {isDeleting ? 'DELETING...' : 'Delete Spot'}
                </button>
            </div>
        </div>
    );
};

// 4. Admin Dashboard
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const AdminPage = () => {
    const { isAdmin, user } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab ] = useState<'list' | 'add' | 'settings' | 'shipping'>('list');
    const [products, setProducts] = useState<Product[]>([]);
    const [whatsappLink, setWhatsappLink] = useState('https://wa.me/16893124370');
    const [telegramLink, setTelegramLink] = useState('');
    const [globalCashApp, setGlobalCashApp] = useState('');
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);

    const [sections, setSections] = useState<HomeSection[]>([]);
    const [shippingRequests, setShippingRequests] = useState<any[]>([]);

    useEffect(() => {
        if (!isAdmin) navigate('/');
        const pQ = collection(db, 'products');
        const unsubP = onSnapshot(pQ, (snap) => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
            setProducts(items);
        });

        const sQ = collection(db, 'home_sections');
        const unsubS = onSnapshot(sQ, (snap) => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as HomeSection));
            setSections(items.sort((a, b) => a.order - b.order));
        });

        const srQ = collection(db, 'shipping_requests');
        const unsubSR = onSnapshot(srQ, (snap) => {
            const reqs = snap.docs.map(d => ({ id: d.id, ...d.data() } as ShippingRequest));
            setShippingRequests(reqs.sort((a, b) => {
                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return dateB - dateA; // Newest first
            }));
        }, (error) => {
            handleFirestoreError(error, OperationType.GET, 'shipping_requests');
        });

        const settingsUnsub = onSnapshot(doc(db, 'settings', 'global'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setWhatsappLink(data.whatsappLink || 'https://wa.me/16893124370');
                setGlobalCashApp(data.cashAppUrl || '');
                setTelegramLink(data.telegramLink || '');
            }
        });

        return () => { unsubP(); unsubS(); unsubSR(); settingsUnsub(); };
    }, [isAdmin]);

    const handleSaveSection = async (section: Partial<HomeSection>) => {
        try {
            if (section.id) {
                await setDoc(doc(db, 'home_sections', section.id), section, { merge: true });
            } else {
                await addDoc(collection(db, 'home_sections'), { ...section, order: sections.length });
            }
        } catch (err) {
            handleFirestoreError(err, section.id ? OperationType.WRITE : OperationType.CREATE, section.id ? `home_sections/${section.id}` : 'home_sections');
        }
    };

    const handleDeleteSection = async (id: string) => {
        setDeletingIds(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
        try {
            await deleteDoc(doc(db, 'home_sections', id));
            alert('Section successfully deleted.');
        } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `home_sections/${id}`);
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const allCategories: string[] = Array.from(new Set(products.map(p => p.category))).filter(Boolean) as string[];

    const handleUpdateSettings = async (updates: any) => {
        try {
            await setDoc(doc(db, 'settings', 'global'), updates, { merge: true });
            alert('Settings updated');
        } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, 'settings/global');
        }
    };

    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

    const handleMarkAsHandled = async (reqId: string) => {
        setDeletingIds(prev => {
            const next = new Set(prev);
            next.add(reqId);
            return next;
        });

        try {
            await deleteDoc(doc(db, 'shipping_requests', reqId));
            alert('Request successfully deleted.');
        } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `shipping_requests/${reqId}`);
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev);
                next.delete(reqId);
                return next;
            });
        }
    };

    const handleDelete = async (id: string): Promise<boolean> => {
        setDeletingIds(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
        try {
            await deleteDoc(doc(db, 'products', id));
            alert('Product successfully deleted.');
            return true;
        } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `products/${id}`);
            return false;
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const handleEdit = (product: Product) => {
        setEditingProduct(product);
        setActiveTab('add');
    };

    if (!isAdmin) return null;

    return (
        <div className="container mx-auto px-6 py-12 space-y-12 min-h-screen">
            <div className="flex justify-between items-end border-b border-purple-500/30 pb-8">
                <div>
                   <h1 className="text-5xl font-black uppercase italic tracking-tighter text-white leading-none">Owner Panel</h1>
                   <p className="text-purple-500 text-xs md:text-sm font-bold uppercase tracking-[0.2em] mt-2 mb-2">Managing the Elite Archives</p>
                </div>
                <div className="bg-zinc-900 border border-white/5 p-1.5 rounded-2xl flex gap-1.5 backdrop-blur-md">
                    <button onClick={() => { setActiveTab('list'); setEditingProduct(null); }} className={cn("px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300", activeTab === 'list' ? "bg-purple-600 text-white shadow-[0_0_25px_rgba(147,51,234,0.4)]" : "text-zinc-500 hover:text-white")}>Inventory</button>
                    <button onClick={() => { setActiveTab('add'); setEditingProduct(null); }} className={cn("px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300", activeTab === 'add' && !editingProduct ? "bg-purple-600 text-white shadow-[0_0_25px_rgba(147,51,234,0.4)]" : "text-zinc-500 hover:text-white")}>New Piece</button>
                    <button onClick={() => { setActiveTab('shipping'); setEditingProduct(null); }} className={cn("px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest relative transition-all duration-300", activeTab === 'shipping' ? "bg-purple-600 text-white shadow-[0_0_25px_rgba(147,51,234,0.4)]" : "text-zinc-500 hover:text-white")}>
                        Shipping
                        {shippingRequests.length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />}
                    </button>
                    <button onClick={() => { setActiveTab('settings'); setEditingProduct(null); }} className={cn("px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300", activeTab === 'settings' ? "bg-purple-600 text-white shadow-[0_0_25px_rgba(147,51,234,0.4)]" : "text-zinc-500 hover:text-white")}>Settings</button>
                </div>
            </div>

            {activeTab === 'list' ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="py-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">Piece</th>
                                <th className="py-6 text-[10px] font-black uppercase tracking-widest text-zinc-500 text-center">Stock</th>
                                <th className="py-6 text-[10px] font-black uppercase tracking-widest text-zinc-500 text-center">Price</th>
                                <th className="py-6 text-[10px] font-black uppercase tracking-widest text-zinc-500 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {products.map(p => (
                                <tr key={p.id} className="group hover:bg-white/2 transition-colors">
                                    <td className="py-6 flex items-center gap-4">
                                        <div className="w-14 aspect-[3/4] rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                                            <ProductImage src={p.images[0]} product={p} />
                                        </div>
                                        <div>
                                            <p className="font-bold text-white tracking-tight leading-none mb-1"><BlurredText text={p.name} /></p>
                                            <p className="text-[10px] text-zinc-500 uppercase font-black"><BlurredText text={p.category} /></p>
                                        </div>
                                    </td>
                                    <td className="py-6 font-bold text-zinc-400 text-center">{p.stock}</td>
                                    <td className="py-6 font-black text-white text-xl text-center tracking-tighter">{formatPrice(p.salePrice || p.price)}</td>
                                    <td className="py-6">
                                        <div className="flex items-center justify-center gap-6">
                                            <button 
                                                onClick={() => handleEdit(p)}
                                                className="text-[10px] font-black uppercase tracking-widest underline underline-offset-4 text-white hover:text-purple-400 transition-colors"
                                            >
                                                Edit
                                            </button>
                                            <button 
                                                onClick={() => handleDelete(p.id)}
                                                disabled={deletingIds.has(p.id)}
                                                className="text-[10px] font-black uppercase tracking-widest underline underline-offset-4 text-red-600 hover:text-red-500 transition-colors disabled:opacity-50"
                                            >
                                                {deletingIds.has(p.id) ? 'DELETING...' : 'Delete'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : activeTab === 'shipping' ? (
                <div className="grid grid-cols-1 gap-6">
                    {shippingRequests.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((req) => (
                        <div key={req.id} className="bg-white/10 backdrop-blur-md p-8 rounded-3xl border border-white/10 shadow-sm space-y-6 text-white text-md">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Request Date</p>
                                    <p className="font-mono text-sm">{req.createdAt ? new Date(req.createdAt).toLocaleString() : 'Recent'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Customer Email</p>
                                    <p className="font-bold text-purple-400 font-mono">{req.email}</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Requested Items</p>
                                <div className="divide-y divide-white/10 border-t border-b border-white/10">
                                    {req.cartItems?.map((item: any) => (
                                        <div key={`${item.id}-${item.size}-${item.color}`} className="py-3 flex justify-between items-center">
                                            <div>
                                                <p className="text-sm font-bold uppercase text-white"><BlurredText text={item.name} /></p>
                                                <div className="flex gap-3 mt-1">
                                                    {item.size && (
                                                        <span className="bg-purple-500/20 text-purple-300 text-[10px] font-black uppercase tracking-[0.1em] px-2 py-0.5 rounded border border-purple-500/30">
                                                            Size: {item.size}
                                                        </span>
                                                    )}
                                                    {item.color && (
                                                        <span className="bg-zinc-800 text-zinc-300 text-[10px] font-black uppercase tracking-[0.1em] px-2 py-0.5 rounded border border-white/5">
                                                            Color: {item.color}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-sm font-black tracking-tight text-white">{formatPrice(item.price)}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Shipping Information */}
                            <div className="space-y-4 pt-4 border-t border-white/5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-purple-500">Shipping Destination</p>
                                {req.shippingInfo ? (
                                    <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-3 text-sm font-mono text-zinc-300 relative overflow-hidden group/ship">
                                        <div className="absolute top-0 right-0 p-3 opacity-10 group-hover/ship:opacity-40 transition-opacity">
                                            <FileText size={40} />
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                                            <p><span className="text-zinc-500 mr-2 uppercase text-[10px] font-black">Recipient:</span> <span className="text-white font-bold">{req.shippingInfo.fullName}</span></p>
                                            <p><span className="text-zinc-500 mr-2 uppercase text-[10px] font-black">Phone:</span> <span className="text-white font-bold">{req.shippingInfo.phoneNumber}</span></p>
                                            <p className="md:col-span-2"><span className="text-zinc-500 mr-2 uppercase text-[10px] font-black">Address:</span> <span className="text-white font-bold">{req.shippingInfo.address}</span></p>
                                            <p className="md:col-span-2"><span className="text-zinc-500 mr-2 uppercase text-[10px] font-black">Location:</span> <span className="text-white font-bold">{req.shippingInfo.city}, {req.shippingInfo.state} {req.shippingInfo.zipCode}</span></p>
                                        </div>
                                        {req.shippingInfo.specialInstructions && (
                                            <div className="mt-4 pt-4 border-t border-white/5">
                                                <p className="text-zinc-500 uppercase text-[10px] font-black mb-1">Special Instructions</p>
                                                <p className="text-zinc-400 italic text-xs leading-relaxed">{req.shippingInfo.specialInstructions}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-red-500/5 border border-red-500/20 p-4 rounded-xl">
                                        <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest animate-pulse">Legacy Order: No Shipping Data Found</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-between items-end pt-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Total Value</p>
                                    <p className="text-xl font-black italic tracking-tighter text-white">{formatPrice(req.total)}</p>
                                </div>
                                <button 
                                    onClick={() => handleMarkAsHandled(req.id)}
                                    disabled={deletingIds.has(req.id)}
                                    className="text-[10px] font-black uppercase text-zinc-500 hover:text-red-500 transition-colors underline disabled:opacity-50"
                                >
                                    {deletingIds.has(req.id) ? 'DELETING...' : 'Mark as Handled'}
                                </button>
                            </div>
                        </div>
                    ))}
                    {shippingRequests.length === 0 && (
                        <div className="text-center py-20 bg-white/5 rounded-3xl border-2 border-dashed border-white/10">
                            <p className="text-zinc-600 font-black uppercase tracking-widest text-xs italic">No pending shipping updates.</p>
                        </div>
                    )}
                </div>
            ) : activeTab === 'settings' ? (
                <div className="space-y-12">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                        <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-sm space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-white/80">
                                <MessageCircle size={16} className="text-green-500" /> WhatsApp Link
                            </h3>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={whatsappLink} 
                                    onChange={(e) => setWhatsappLink(e.target.value)}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none text-white font-mono"
                                    placeholder="https://wa.me/..."
                                />
                                <button 
                                    onClick={() => handleUpdateSettings({ whatsappLink: whatsappLink })}
                                    className="bg-purple-600 text-white px-6 py-3 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-purple-700 transition-colors shadow-lg shadow-purple-500/10"
                                >
                                    Save
                                </button>
                            </div>
                        </div>

                        <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-sm space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-white/80">
                                <MessageCircle size={16} className="text-blue-400" /> Telegram Link
                            </h3>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={telegramLink} 
                                    onChange={(e) => setTelegramLink(e.target.value)}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none text-white font-mono"
                                    placeholder="https://t.me/..."
                                />
                                <button 
                                    onClick={() => handleUpdateSettings({ telegramLink: telegramLink })}
                                    className="bg-purple-600 text-white px-6 py-3 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-purple-700 transition-colors shadow-lg shadow-purple-500/10"
                                >
                                    Save
                                </button>
                            </div>
                        </div>

                        <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-sm space-y-4">
                            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 text-white/80">
                                <span className="text-[#00D632] font-black">$</span> Global CashApp (Fallback)
                            </h3>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={globalCashApp} 
                                    onChange={(e) => setGlobalCashApp(e.target.value)}
                                    className="flex-1 bg-white/5 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none text-white font-mono"
                                    placeholder="$2footmike"
                                />
                                <button 
                                    onClick={() => handleUpdateSettings({ cashAppUrl: globalCashApp })}
                                    className="bg-purple-600 text-white px-6 py-3 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-purple-700 transition-colors shadow-lg shadow-purple-500/10"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="flex justify-between items-end">
                            <div>
                                <h3 className="text-xl font-black uppercase italic tracking-tighter">Home Page Spots</h3>
                                <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Organize your archived categories</p>
                            </div>
                            <button 
                                onClick={() => handleSaveSection({ title: 'New Spot', subtitle: 'Subheading', categories: [], order: sections.length })}
                                className="bg-purple-600 text-white px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all shadow-xl shadow-purple-500/20"
                            >
                                Add New Spot
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {sections.map(section => (
                                <SectionEditor 
                                    key={section.id} 
                                    section={section} 
                                    onSave={handleSaveSection} 
                                    onDelete={handleDeleteSection}
                                    allCategories={allCategories}
                                    isFirst={section.order === 0}
                                    isLast={section.order === sections.length - 1}
                                    isDeleting={deletingIds.has(section.id)}
                                />
                            ))}
                            {sections.length === 0 && (
                                <div className="text-center py-12 bg-white/5 rounded-3xl border-2 border-dashed border-white/10">
                                    <p className="text-zinc-600 font-bold uppercase tracking-widest text-xs italic">No home spots configured.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <ProductForm 
                    key={editingProduct?.id || 'new'} 
                    initialData={editingProduct || undefined} 
                    allCategories={allCategories}
                    onComplete={() => { setActiveTab('list'); setEditingProduct(null); }} 
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
};

const ProductForm = ({ onComplete, initialData, allCategories, onDelete }: { 
    onComplete: () => void, 
    initialData?: Product, 
    allCategories: string[], 
    onDelete?: (id: string) => Promise<boolean>,
    key?: any 
}) => {
    const [form, setForm] = useState({
        name: initialData?.name || '',
        description: initialData?.description || '',
        price: initialData?.price || 0,
        salePrice: initialData?.salePrice || 0,
        stock: initialData?.stock || 0,
        category: initialData?.category || '',
        shopUrl: initialData?.shopUrl || '',
        cashAppUrl: initialData?.cashAppUrl || '',
        imagesStr: initialData?.images.join(', ') || '',
        graphicUrl: (initialData as any)?.graphicUrl || '',
        pdfUrl: initialData?.pdfUrl || '',
        sizesStr: initialData?.sizes?.join(', ') || '',
        colorsStr: initialData?.colors?.join(', ') || ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadingPdf, setUploadingPdf] = useState(false);
    const [uploadingGraphic, setUploadingGraphic] = useState(false);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        setUploading(true);
        
        try {
            const urls: string[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.size > 500000) {
                    alert("Image too large. Please use images smaller than 500KB.");
                    continue;
                }
                const reader = new FileReader();
                const promise = new Promise<string>((resolve) => {
                    reader.onloadend = () => resolve(reader.result as string);
                });
                reader.readAsDataURL(file);
                urls.push(await promise);
            }
            if (urls.length > 0) {
                const currentImages = form.imagesStr.split(',').map(s => s.trim()).filter(Boolean);
                setForm(prev => ({ ...prev, imagesStr: [...currentImages, ...urls].join(', ') }));
            }
        } catch (err) {
            console.error("Upload failed", err);
        } finally {
            setUploading(false);
        }
    };

    const handleGraphicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingGraphic(true);
        try {
            if (file.size > 500000) {
                alert("Graphic too large. Please use a file smaller than 500KB.");
                return;
            }
            const reader = new FileReader();
            const promise = new Promise<string>((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
            });
            reader.readAsDataURL(file);
            const base64 = await promise;
            setForm(prev => ({ ...prev, graphicUrl: base64 }));
        } catch (err) {
            console.error("Graphic upload failed", err);
        } finally {
            setUploadingGraphic(false);
        }
    };

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadingPdf(true);
        try {
            if (file.size > 500000) {
                alert("PDF too large. Please use a file smaller than 500KB.");
                return;
            }
            const reader = new FileReader();
            const promise = new Promise<string>((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
            });
            reader.readAsDataURL(file);
            const base64 = await promise;
            setForm(prev => ({ ...prev, pdfUrl: base64 }));
        } catch (err) {
            console.error("PDF upload failed", err);
        } finally {
            setUploadingPdf(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const productData: any = {
                name: form.name,
                description: form.description,
                price: Number(form.price),
                salePrice: form.salePrice ? Number(form.salePrice) : null,
                stock: Number(form.stock),
                category: form.category,
                shopUrl: form.shopUrl,
                cashAppUrl: form.cashAppUrl,
                images: form.imagesStr.split(',').map(s => s.trim()).filter(Boolean),
                graphicUrl: form.graphicUrl,
                pdfUrl: form.pdfUrl,
                sizes: form.sizesStr.split(',').map(s => s.trim()).filter(Boolean),
                colors: form.colorsStr.split(',').map(s => s.trim()).filter(Boolean),
                updatedAt: new Date().toISOString()
            };
            
            if (initialData?.id) {
                await setDoc(doc(db, 'products', initialData.id), productData, { merge: true });
            } else {
                productData.createdAt = new Date().toISOString();
                await addDoc(collection(db, 'products'), productData);
            }
            onComplete();
        } catch (err) {
            handleFirestoreError(err, initialData?.id ? OperationType.WRITE : OperationType.CREATE, initialData?.id ? `products/${initialData.id}` : 'products');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6 bg-white/5 p-8 rounded-[2rem] border border-white/10 shadow-2xl">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Name</label>
                    <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white" required />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Category</label>
                    <div className="relative">
                        <input 
                            type="text" 
                            value={form.category} 
                            onChange={e => setForm({...form, category: e.target.value})} 
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white" 
                            required 
                            list="existing-categories"
                        />
                        <datalist id="existing-categories">
                            {allCategories.map(cat => (
                                <option key={cat} value={cat} />
                            ))}
                        </datalist>
                    </div>
                </div>
            </div>
            <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Description</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all min-h-[100px] text-white" required />
            </div>
            <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Price</label>
                    <input type="number" value={form.price} onChange={e => setForm({...form, price: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white font-mono" required />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Sale Price</label>
                    <input type="number" value={form.salePrice} onChange={e => setForm({...form, salePrice: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white font-mono" />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Stock</label>
                    <input type="number" value={form.stock} onChange={e => setForm({...form, stock: Number(e.target.value)})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white font-mono" required />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Available Sizes (S, M, L...)</label>
                    <input type="text" value={form.sizesStr} onChange={e => setForm({...form, sizesStr: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white" placeholder="S, M, L, XL" />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">Available Colors (Black, White...)</label>
                    <input type="text" value={form.colorsStr} onChange={e => setForm({...form, colorsStr: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white" placeholder="Black, White, Grey" />
                </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                    <label className="text-xs font-black uppercase tracking-widest text-zinc-500">CashApp Link / Username</label>
                    <input type="text" value={form.cashAppUrl} onChange={e => setForm({...form, cashAppUrl: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-600 outline-none transition-all text-white" placeholder="e.g. $username or https://cash.app/$username" />
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-widest text-zinc-400 block font-mono">Assets Management</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Image URLs (JPG/PNG)</label>
                            <input type="text" value={form.imagesStr} onChange={e => setForm({...form, imagesStr: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-500 outline-none transition-all text-white" placeholder="https://..." />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Upload Photos</label>
                            <label className="flex flex-col items-center justify-center w-full h-[52px] border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:bg-white/5 transition-all">
                                <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">
                                    {uploading ? 'Processing...' : 'JPG / PNG'}
                                </span>
                                <input type="file" className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                            </label>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">PNG Graphic Asset</label>
                            <input type="text" value={form.graphicUrl} onChange={e => setForm({...form, graphicUrl: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-500 outline-none transition-all text-white font-mono" placeholder="Transparent PNG URL" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Upload Brand PNG</label>
                            <label className="flex flex-col items-center justify-center w-full h-[52px] border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:bg-white/5 transition-all">
                                <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">
                                    {uploadingGraphic ? 'Uploading...' : form.graphicUrl ? 'PNG Attached' : 'Select PNG'}
                                </span>
                                <input type="file" className="hidden" accept="image/png" onChange={handleGraphicUpload} />
                            </label>
                            {form.graphicUrl && (
                                <button type="button" onClick={() => setForm({...form, graphicUrl: ''})} className="text-[9px] font-bold text-red-500 uppercase tracking-tighter hover:underline">Remove Graphic</button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">PDF Document</label>
                            <input type="text" value={form.pdfUrl} onChange={e => setForm({...form, pdfUrl: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm focus:ring-purple-500 outline-none transition-all text-white font-mono" placeholder="Size Guide PDF URL" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Upload PDF</label>
                            <label className="flex flex-col items-center justify-center w-full h-[52px] border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:bg-white/5 transition-all">
                                <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">
                                    {uploadingPdf ? 'Uploading...' : form.pdfUrl ? 'PDF Attached' : 'Select PDF'}
                                </span>
                                <input type="file" className="hidden" accept=".pdf" onChange={handlePdfUpload} />
                            </label>
                            {form.pdfUrl && (
                                <button type="button" onClick={() => setForm({...form, pdfUrl: ''})} className="text-[9px] font-bold text-red-500 uppercase tracking-tighter hover:underline">Remove PDF</button>
                            )}
                        </div>
                    </div>
                </div>
                {form.imagesStr && (
                    <div className="flex gap-2 overflow-x-auto py-2">
                        {form.imagesStr.split(',').map((img, i) => (
                            <div key={i} className="relative w-16 aspect-[3/4] flex-shrink-0 group">
                                <img src={img.trim()} className="w-full h-full object-cover rounded border border-white/10 shadow-lg" referrerPolicy="no-referrer" />
                                <button 
                                    type="button"
                                    onClick={() => {
                                        const imgs = form.imagesStr.split(',').map(s => s.trim()).filter((_, idx) => idx !== i);
                                        setForm({...form, imagesStr: imgs.join(', ')});
                                    }}
                                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="space-y-4 pt-4">
                <button disabled={submitting || uploading || uploadingPdf} type="submit" className="w-full bg-purple-600 text-white py-4 rounded-full font-bold uppercase tracking-widest text-sm hover:bg-purple-700 shadow-xl shadow-purple-600/20 transition-all font-mono">
                    {initialData?.id ? 'Update Piece' : 'Drop Item'}
                </button>

                {initialData?.id && onDelete && (
                    <button 
                        type="button"
                        onClick={async () => {
                            const success = await onDelete(initialData.id!);
                            if (success) {
                                onComplete();
                            }
                        }}
                        className="w-full text-red-500 font-black uppercase tracking-widest text-[10px] py-2 hover:text-red-400 transition-colors underline underline-offset-4"
                    >
                        PERMANENTLY DELETE THIS PIECE
                    </button>
                )}
            </div>
        </form>
    );
};

// 5. Cart Logic (Simplified for this demo) - usually would have a hook
const Navbar = ({ whatsappLink }: { whatsappLink: string }) => {
  const { user, isAdmin, signIn, logout, isSigningIn } = useAuth();
  const { cart, isCartOpen, setIsCartOpen } = useCart();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  const isHome = location.pathname === '/';

  return (
    <nav className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-6 py-4 flex items-center justify-between",
      isScrolled ? "bg-black/80 backdrop-blur-md border-b border-white/10 py-3 text-white" : 
      isHome ? "bg-transparent py-6" : "bg-black border-b border-white/10 py-3 text-white"
    )}>
      <div className="flex items-center gap-12">
        <Link to="/" className={cn(
          "text-2xl font-black uppercase italic tracking-tighter",
          "text-white"
        )}>
           Elite<span className="text-purple-500">1:1</span>
        </Link>
        <div className={cn(
          "hidden lg:flex gap-8 text-[10px] font-bold uppercase tracking-[0.2em]",
          "text-white/60"
        )}>
          <Link to="/shop" className="hover:text-white transition-colors">Archive</Link>
          <Link to="/drops" className="hover:text-white transition-colors">Drops</Link>
          <span className="text-white/40">Contact: 689-312-4370</span>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-6">
        {isAdmin && (
           <Link to="/admin" className="p-2 rounded-full transition-colors text-white/60 hover:bg-white/10 hover:text-white">
             <Settings size={20} />
           </Link>
        )}
        <button 
          onClick={() => setIsCartOpen(true)}
          className="p-2 rounded-full relative group transition-colors text-white/60 hover:bg-white/10 hover:text-white"
        >
          <ShoppingCart size={20} />
          <span className="absolute -top-1 -right-1 bg-purple-600 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full group-hover:scale-110 transition-transform shadow-sm">
            {cart.reduce((acc, item) => acc + item.quantity, 0)}
          </span>
        </button>
        
        {user ? (
          <button onClick={logout} className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all bg-white/5 text-white hover:bg-white/10 border border-white/10">
            <img src={user.photoURL || ''} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        ) : (
          <button 
            onClick={signIn} 
            disabled={isSigningIn}
            className={cn(
                "flex items-center gap-2 px-4 md:px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all bg-purple-600 text-white hover:bg-purple-700 shadow-xl shadow-purple-500/20 disabled:opacity-50",
                isSigningIn && "animate-pulse"
            )}
          >
            {isSigningIn ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
                <LogIn size={16} />
            )}
            <span className="hidden sm:inline">{isSigningIn ? 'Connecting...' : 'Connect'}</span>
          </button>
        )}

        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="lg:hidden p-2 text-white/60 hover:text-white transition-colors"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 right-0 bg-black border-b border-white/10 p-6 flex flex-col gap-6 lg:hidden shadow-2xl"
          >
            <Link to="/shop" className="text-sm font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">Archive</Link>
            <Link to="/drops" className="text-sm font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">Drops</Link>
            <span className="text-sm font-black uppercase tracking-widest text-zinc-500">Contact: 689-312-4370</span>
          </motion.div>
        )}
      </AnimatePresence>

      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </nav>
  );
};

const CartDrawer = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const { cart, removeFromCart, total } = useCart();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalCashApp, setGlobalCashApp] = useState('');
  const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState<{method: 'shop' | 'cashapp', item?: any} | null>(null);

  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'global'), (snap) => {
      if (snap.exists()) setGlobalCashApp(snap.data().cashAppUrl || '');
    });
  }, []);

  const handleBuyNow = async (method: 'shop' | 'cashapp' = 'shop', specificItem?: any) => {
    setPendingCheckout({ method, item: specificItem });
    setIsShippingModalOpen(true);
  };

  const handleShippingComplete = async (shippingInfo: ShippingInfo) => {
    if (!pendingCheckout) return;
    const { method, item: specificItem } = pendingCheckout;
    setIsShippingModalOpen(false);
    setPendingCheckout(null);

    let checkoutUrl = "https://shop.app";
    const itemsToCheckout = specificItem ? [specificItem] : cart;
    const checkoutTotal = specificItem ? (specificItem.salePrice || specificItem.price) : total;
    
    if (method === 'shop') {
      checkoutUrl = itemsToCheckout.length === 1 ? (itemsToCheckout[0].shopUrl || "https://shop.app") : "https://shop.app";
    } else {
      let url = globalCashApp || "$2footmike";
      if (itemsToCheckout.length === 1 && itemsToCheckout[0].cashAppUrl) {
          url = itemsToCheckout[0].cashAppUrl;
      }
      checkoutUrl = url.startsWith('$') ? `https://cash.app/${url}` : url;
    }
    
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'shipping_requests'), {
        email: user?.email || 'Guest',
        orderType: method === 'cashapp' ? 'CASHAPP' : 'SHOP',
        cartItems: itemsToCheckout.map(item => ({
          id: item.id,
          name: item.name,
          size: item.selectedSize || 'N/A',
          color: item.selectedColor || 'N/A',
          price: item.salePrice || item.price
        })),
        total: checkoutTotal,
        shippingInfo,
        createdAt: new Date().toISOString()
      });
      window.open(checkoutUrl, '_blank');
    } catch (err) {
      console.error("Error saving shipping request:", err);
      alert("There was an error processing your request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" 
          />
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-black border-l border-white/5 z-[70] shadow-2xl flex flex-col noise-overlay"
          >
            <div className="p-6 flex items-center justify-between border-b border-white/5">
              <h2 className="text-xl font-bold uppercase tracking-tighter flex items-center gap-2 text-white">
                <ShoppingBag size={20} className="text-purple-500" />
                Your Archive
              </h2>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              {cart.map((item) => (
                <div key={`${item.id}-${item.selectedSize}-${item.selectedColor}`} className="flex gap-4 group">
                  <div className="w-20 aspect-[3/4] bg-zinc-900 rounded-lg overflow-hidden flex-shrink-0 border border-white/5 shadow-xl">
                    <ProductImage src={item.images[0]} product={item as any} />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-start">
                      <h3 className="text-sm font-bold leading-tight uppercase text-white">
                        <BlurredText text={item.name} />
                      </h3>
                      <button onClick={() => removeFromCart(item.id, item.selectedSize, item.selectedColor)} className="text-zinc-600 hover:text-red-500 transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <p className="text-xs text-purple-400 uppercase tracking-widest font-black">
                       <BlurredText text={item.category} />
                    </p>
                    {(item.selectedSize || item.selectedColor) && (
                       <div className="flex gap-2 pt-1 font-mono">
                          {item.selectedSize && <span className="text-[10px] font-bold bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded uppercase tracking-tighter">Size: {item.selectedSize}</span>}
                          {item.selectedColor && <span className="text-[10px] font-bold bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded uppercase tracking-tighter">Color: {item.selectedColor}</span>}
                       </div>
                    )}
                    <div className="flex items-center justify-between pt-2">
                       <span className="text-sm font-black text-white">{formatPrice(item.salePrice || item.price)}</span>
                       <button 
                         onClick={() => handleBuyNow('cashapp', item)}
                         disabled={isSubmitting}
                         className="text-[10px] font-black uppercase text-purple-400 hover:text-purple-300 hover:underline disabled:opacity-50"
                       >
                         Checkout Item
                       </button>
                    </div>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20">
                  <ShoppingBag size={48} className="text-zinc-800" />
                  <p className="text-zinc-500 uppercase tracking-widest text-xs font-black">Your archive is empty.</p>
                  <button onClick={onClose} className="text-purple-500 underline font-black uppercase tracking-widest text-[10px] hover:text-purple-400">Start Sourcing</button>
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="p-6 bg-zinc-950 border-t border-white/5 space-y-6">
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm font-bold uppercase tracking-widest text-zinc-400 font-mono">Total Value</span>
                  <span className="text-2xl font-black italic tracking-tighter text-white">{formatPrice(total)}</span>
                </div>
                
                <div className="space-y-3">
                  <button 
                    onClick={() => handleBuyNow('cashapp')}
                    disabled={isSubmitting}
                    className="w-full bg-[#00D632] text-white py-4 rounded-xl font-black uppercase tracking-widest text-center flex items-center justify-center gap-3 hover:opacity-90 transition-all shadow-xl shadow-green-950/20 disabled:opacity-50"
                  >
                    Buy with CashApp
                  </button>
                  <p className="text-[10px] text-zinc-600 text-center uppercase tracking-widest font-black italic">Secured Checkout via Official Channels</p>
                </div>
              </div>
            )}
          </motion.div>
          <ShippingModal 
            isOpen={isShippingModalOpen} 
            onClose={() => setIsShippingModalOpen(false)} 
            onComplete={handleShippingComplete} 
          />
        </>
      )}
    </AnimatePresence>
  );
};


const AppContent = () => {
    const [whatsappLink, setWhatsappLink] = useState('https://wa.me/16893124370');
    const [telegramLink, setTelegramLink] = useState('');

    useEffect(() => {
        return onSnapshot(doc(db, 'settings', 'global'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setWhatsappLink(data.whatsappLink || 'https://wa.me/16893124370');
                setTelegramLink(data.telegramLink || '');
            }
        });
    }, []);

    return (
        <div className="min-h-screen bg-black font-sans text-white pt-[72px] noise-overlay">
            <Navbar whatsappLink={whatsappLink} />
            <AnimatePresence mode="wait">
                <Routes>
                    <Route path="/" element={<HomePage whatsappLink={whatsappLink} />} />
                    <Route path="/shop" element={<ShopPage />} />
                    <Route path="/product/:id" element={<ProductDetailPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="*" element={<Navigate to="/" />} />
                </Routes>
            </AnimatePresence>
            
      <footer className="bg-zinc-950 py-20 border-t border-white/5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1px] bg-linear-to-r from-transparent via-purple-500/50 to-transparent" />
        <div className="container mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="space-y-6">
            <h3 className="text-xl font-black uppercase italic tracking-tighter text-white">Elite<span className="text-purple-500">1:1</span></h3>
            <p className="text-sm text-zinc-400 font-light leading-relaxed">
              The premier destination for high-end 1:1 luxury apparel. Curated archives, restricted drops.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-purple-400">Navigation</h4>
            <ul className="space-y-2 text-sm font-medium text-zinc-300">
              <li><Link to="/shop" className="hover:text-purple-400 hover:underline transition-colors">Collection</Link></li>
              <li><Link to="/drops" className="hover:text-purple-400 hover:underline transition-colors">Drops Schedule</Link></li>
              <li><Link to="/terms" className="hover:text-purple-400 hover:underline transition-colors">Terms of Service</Link></li>
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-green-400">Connect</h4>
            <ul className="space-y-2 text-sm font-medium text-zinc-300">
              <li><span className="text-green-400">Contact: 689-312-4370</span></li>
              {telegramLink && <li><a href={telegramLink} target="_blank" className="hover:text-blue-400 hover:underline transition-colors">Telegram Channel</a></li>}
              <li><a href="https://instagram.com" target="_blank" className="hover:text-purple-400 hover:underline transition-colors">Instagram</a></li>
              <li><a href="mailto:support@elite11.io" className="hover:text-purple-400 hover:underline transition-colors">Email Support</a></li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-6 mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest">© 2026 ELITE 1:1 ARCHIVE. ALL RIGHTS RESERVED.</p>
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest italic">Quality over everything.</p>
        </div>
      </footer>
    </div>
  );
};

const ShippingModal = ({ 
  isOpen, 
  onClose, 
  onComplete 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onComplete: (info: ShippingInfo) => void;
}) => {
  const [info, setInfo] = useState<ShippingInfo>({
    fullName: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phoneNumber: '',
    specialInstructions: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required fields (though marked required in HTML)
    if (!info.fullName || !info.address || !info.city || !info.state || !info.zipCode || !info.phoneNumber) {
      alert("Please fill in all required fields.");
      return;
    }
    onComplete(info);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
               // Only close if clicking the backdrop, not the modal content
               if (e.target === e.currentTarget) onClose();
            }}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
          >
            <div className="flex items-center justify-center min-h-screen p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-lg bg-zinc-900 border border-white/10 rounded-[2.5rem] overflow-hidden shadow-2xl p-8"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h2 className="text-3xl font-black uppercase tracking-tighter italic text-white flex items-center gap-2">
                       SHIPPING<span className="text-purple-500">DETAILS</span>
                    </h2>
                    <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mt-1">Verify your delivery information</p>
                  </div>
                  <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-zinc-500 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="mb-6 p-4 bg-purple-500/5 rounded-2xl border border-purple-500/10">
                  <p className="text-[10px] font-black uppercase tracking-widest text-purple-400 mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                    Required Shipping Information
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {['Full Name', 'Phone Number', 'Full Address', 'City / State', 'ZIP Code', 'Logistics Notes'].map((item) => (
                      <div key={item} className="flex items-center gap-2 text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                        <div className="w-1 h-1 rounded-full bg-zinc-700" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">Full Name</label>
                      <input 
                        required
                        placeholder="John Doe"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors font-mono"
                        value={info.fullName}
                        onChange={e => setInfo({...info, fullName: e.target.value})}
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">Address</label>
                      <input 
                        required
                        placeholder="123 Street Ave"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors font-mono"
                        value={info.address}
                        onChange={e => setInfo({...info, address: e.target.value})}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">City</label>
                        <input 
                          required
                          placeholder="City"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors font-mono"
                          value={info.city}
                          onChange={e => setInfo({...info, city: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">State</label>
                        <input 
                          required
                          placeholder="State"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors font-mono"
                          value={info.state}
                          onChange={e => setInfo({...info, state: e.target.value})}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">ZIP Code</label>
                        <input 
                          required
                          placeholder="00000"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors font-mono"
                          value={info.zipCode}
                          onChange={e => setInfo({...info, zipCode: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">Phone</label>
                        <input 
                          required
                          type="tel"
                          placeholder="689-312-4370"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors font-mono"
                          value={info.phoneNumber}
                          onChange={e => setInfo({...info, phoneNumber: e.target.value})}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 px-1">Special Instructions (Optional)</label>
                      <textarea 
                        placeholder="Notes for delivery..."
                        rows={2}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white text-sm focus:border-purple-500 outline-none transition-colors resize-none font-mono"
                        value={info.specialInstructions}
                        onChange={e => setInfo({...info, specialInstructions: e.target.value})}
                      />
                    </div>
                  </div>
                  
                  <button 
                    type="submit"
                    className="w-full bg-purple-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest hover:bg-purple-700 transition-all shadow-xl shadow-purple-500/20 mt-4"
                  >
                    Confirm & Pay
                  </button>
                </form>
              </motion.div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  );
}
