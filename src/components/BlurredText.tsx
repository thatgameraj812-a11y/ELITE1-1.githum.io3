import React from 'react';
import { cn } from '../lib/utils';

export const BANNED_BRANDS = [
  'Hellstar', 'Corteiz', 'Trapstar', 'Denim Tears', 'Sp5der', 'Spider', 'Spi5er', 'Spid3r', 'Minus Two',
  'Synaworld', 'Chrome Hearts', 'Nike', 'Adidas', 'Jordan', 'Vuitton', 'Louis Vuitton', 'LV',
  'Gucci', 'Prada', 'Balenciaga', 'Bape', 'Stussy', 'Essentials', '3ssentials', '3ssientals', 'Fear of God', 'FOG',
  'Off White', 'Palm Angels', 'Moncler', 'Canada Goose', 'Gallery Dept', 'ArcTeryx',
  'Burberry', 'Vlone', 'Givenchy', 'Dior', 'Rick Owens', 'Amiri', 'Celine', 'Chanel',
  'Hermes', 'Versace', 'Fendi', 'Valentino', 'Valintieno', 'Va1tieno', 'Valentinol', 'Saint Laurent', 'YSL', 'Stone Island',
  'Marcelo Burlon', 'Represent', 'Gallery Department', 'Kith', 'Supreme'
];

interface BlurredTextProps {
  text: string;
  className?: string;
  blurClassName?: string;
}

export const BlurredText: React.FC<BlurredTextProps> = ({ text, className, blurClassName }) => {
  if (!text) return null;

  // Build a single regex for all brands
  const escapedBrands = BANNED_BRANDS.map(b => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(\\b(?:${escapedBrands.join('|')})\\b)`, 'gi');

  const parts = text.split(regex);

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const isBrand = BANNED_BRANDS.some(brand => brand.toLowerCase() === part.toLowerCase());
        
        if (isBrand) {
          return (
            <span 
              key={i} 
              className={cn(
                "blur-[4px] select-none cursor-help bg-white/5 rounded px-0.5 transition-all hover:blur-[2px] text-white/90", 
                blurClassName
              )}
              title="Brand blurred for copyright protection"
            >
              {part}
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
};
