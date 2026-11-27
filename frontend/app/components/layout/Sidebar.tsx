import { useState } from 'react'
import { BarChart3, FileText, NotebookPen, Coins, MessageSquare, Mail, Bot, Ghost, ScrollText, Settings, FlaskConical, Github, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ContactDialog from '@/components/contact/ContactDialog'
import ExchangeModal from '@/components/exchange/ExchangeModal'
import ExchangeIcon from '@/components/exchange/ExchangeIcon'
import TradingModeConfirmDialog from '@/components/trading/TradingModeConfirmDialog'
import { useTradingMode, type TradingMode } from '@/contexts/TradingModeContext'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// AI Trader icon component (custom SVG)
const AITraderIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M946 528.156a18 18 0 0 1-18-18V102a18 18 0 0 1 36 0v408.156a18 18 0 0 1-18 18zM70 527.064a18.004 18.004 0 0 1-18-18V102a18 18 0 0 1 36 0v407.06a18.004 18.004 0 0 1-18 18.004z" fill="#6E6E96"/>
    <path d="M27.016 680.908c0 30.928 25.072 56 56 56H930c30.928 0 56-25.072 56-56v-115.844c0-30.928-25.072-56-56-56H83.016c-30.928 0-56 25.072-56 56v115.844z" fill="#54BCE8"/>
    <path d="M930 754.916H83.016c-40.804 0-74-33.196-74-74v-115.852c0-40.804 33.196-74 74-74H930c40.804 0 74 33.192 74 74v115.852c0 40.804-33.196 74-74 74zM83.016 527.064c-20.952 0-38 17.048-38 38v115.852c0 20.948 17.048 38 38 38H930c20.952 0 38-17.052 38-38v-115.852c0-20.952-17.048-38-38-38H83.016z" fill="#6E6E96"/>
    <path d="M881.236 835.864c0 68.1-55.716 123.816-123.812 123.816H258.612c-68.1 0-123.816-55.716-123.816-123.816v-425.76c0-68.1 55.716-123.816 123.816-123.816h498.804c68.1 0 123.82 55.716 123.82 123.816v425.76z" fill="#7FDDFF"/>
    <path d="M345.284 575.208m-114.972 0a114.972 114.972 0 1 0 229.944 0 114.972 114.972 0 1 0-229.944 0Z" fill="#E6E8F3"/>
    <path d="M672.08 575.208m-114.972 0a114.972 114.972 0 1 0 229.944 0 114.972 114.972 0 1 0-229.944 0Z" fill="#E6E8F3"/>
    <path d="M320 555.208h48.792V604H320zM647.688 555.208h48.792V604h-48.792zM374.76 782h274.484v36H374.76z" fill="#6E6E96"/>
  </svg>
)

// K-Lines icon component (custom SVG)
const KLinesIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1026 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M59.733333 910.222222V51.2h-56.888889v910.222222h1024V910.222222z"/>
    <path d="M258.844444 620.088889h56.888889v-85.333333h56.888889v-227.555556h-56.888889v-56.888889h-56.888889v56.888889h-56.888888v227.555556h56.888888zM514.844444 790.755556h56.888889v-256h56.888889v-341.333334h-56.888889v-113.777778h-56.888889v113.777778h-56.888888v341.333334h56.888888zM770.844444 705.422222h56.888889v-142.222222h56.888889v-199.111111h-56.888889v-142.222222h-56.888889v142.222222h-56.888888v199.111111h56.888888z"/>
  </svg>
)

// Premium icon component (custom SVG)
const PremiumIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M270.218971 121.212343h483.474286a29.257143 29.257143 0 0 1 23.3472 11.644343l188.416 249.885257a29.257143 29.257143 0 0 1-1.8432 37.419886L533.942857 887.749486a29.257143 29.257143 0 0 1-43.037257 0.058514L60.416 421.595429a29.257143 29.257143 0 0 1-1.930971-37.390629l188.328228-251.260343a29.257143 29.257143 0 0 1 23.405714-11.702857z" fill="#FFA100"/>
    <path d="M768.292571 121.212343l197.163886 261.558857a29.257143 29.257143 0 0 1-1.8432 37.390629L532.714057 889.066057a11.702857 11.702857 0 0 1-20.304457-7.899428L512 257.024l256.292571-135.840914z" fill="#FFC663"/>
    <path d="M721.598171 386.340571a29.257143 29.257143 0 0 1 0.994743 1.024l22.7328 23.873829a29.257143 29.257143 0 0 1 0 40.3456l-189.410743 198.890057-22.7328 23.873829a29.257143 29.257143 0 0 1-1.726171 1.667657l1.755429-1.667657a29.4912 29.4912 0 0 1-19.456 9.0112 28.935314 28.935314 0 0 1-18.080915-4.9152 30.193371 30.193371 0 0 1-4.856685-4.096l1.960228 1.872457-0.965486-0.877714-0.994742-0.994743-22.7328-23.873829-189.410743-198.890057a29.257143 29.257143 0 0 1 0-40.374857l22.7328-23.844572a29.257143 29.257143 0 0 1 42.364343 0L512 563.960686l168.228571-176.596115a29.257143 29.257143 0 0 1 41.3696-1.024z" fill="currentColor"/>
  </svg>
)

// Signal icon component (custom SVG)
const SignalIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M1024 483.2c-6.4-124.8-60.8-243.2-150.4-332.8C784 60.8 665.6 9.6 540.8 0h-57.6C358.4 9.6 240 60.8 150.4 150.4 60.8 240 9.6 358.4 0 483.2v57.6c6.4 124.8 60.8 243.2 150.4 332.8 89.6 89.6 208 140.8 332.8 150.4h57.6c124.8-6.4 243.2-60.8 332.8-150.4 89.6-89.6 140.8-208 150.4-332.8v-57.6zM396.8 262.4c28.8-12.8 57.6-22.4 86.4-25.6v124.8c-60.8 12.8-108.8 60.8-121.6 121.6H236.8c3.2-41.6 19.2-83.2 41.6-118.4 12.8 6.4 25.6 9.6 38.4 9.6 48 0 83.2-38.4 83.2-83.2 0-12.8 0-19.2-3.2-28.8zM230.4 288c0 12.8 3.2 22.4 6.4 35.2-32 48-51.2 102.4-57.6 160H57.6C70.4 256 256 70.4 483.2 57.6v124.8c-44.8 3.2-86.4 16-124.8 35.2-12.8-6.4-28.8-12.8-44.8-12.8-44.8 0-83.2 38.4-83.2 83.2z m131.2 252.8c12.8 60.8 60.8 108.8 121.6 121.6v124.8c-128-12.8-233.6-115.2-246.4-246.4h124.8z m121.6 300.8v124.8C256 953.6 70.4 768 57.6 540.8h124.8c12.8 160 140.8 288 300.8 300.8z m0-300.8v64c-32-9.6-54.4-35.2-64-64h64z m0-121.6v64h-64c9.6-32 32-54.4 64-64z m57.6 64v-64c32 9.6 54.4 35.2 64 64h-64z m188.8 57.6c6.4 22.4 25.6 38.4 44.8 48-32 108.8-124.8 185.6-236.8 198.4v-124.8c60.8-12.8 108.8-60.8 121.6-121.6h70.4z m3.2-57.6h-70.4c-12.8-60.8-60.8-108.8-121.6-121.6V236.8c112 12.8 204.8 89.6 236.8 198.4-22.4 9.6-38.4 25.6-44.8 48z m-192 121.6v-64h64c-9.6 32-32 54.4-64 64z m0 236.8c70.4-6.4 134.4-32 185.6-76.8 25.6-22.4 51.2-51.2 67.2-80 19.2-28.8 32-60.8 38.4-92.8 25.6-6.4 48-28.8 54.4-51.2h76.8C953.6 768 768 953.6 540.8 966.4v-124.8z m256-502.4c-19.2-28.8-41.6-57.6-67.2-80-54.4-44.8-118.4-70.4-185.6-76.8V57.6c224 12.8 409.6 198.4 422.4 425.6h-76.8c-9.6-25.6-28.8-44.8-54.4-51.2-9.6-35.2-22.4-64-38.4-92.8z"/>
  </svg>
)

// Attribution icon component (custom SVG)
const AttributionIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M341.333333 426.666667a213.333333 213.333333 0 1 0 426.666667 0 213.333333 213.333333 0 0 0-426.666667 0z" opacity="0.9"/>
    <path d="M259.84 470.4c-75.605333 18.773333-131.584 86.613333-131.754667 167.253333-0.170667 93.824 78.677333 172.416 173.397334 173.013334a174.293333 174.293333 0 0 0 166.144-117.162667 33.194667 33.194667 0 0 0-19.84-41.856 240.768 240.768 0 0 1-147.328-158.293333 33.536 33.536 0 0 0-40.618667-22.997334v0.042667z" opacity="0.6"/>
    <path d="M170.666667 245.333333a74.709333 74.709333 0 0 0 112 64.682667A74.666667 74.666667 0 1 0 170.666667 245.333333zM769.152 597.333333A128.128 128.128 0 0 0 640 726.485333 128.042667 128.042667 0 0 0 766.848 853.333333 128.128 128.128 0 0 0 896 724.181333 128.128 128.128 0 0 0 769.152 597.333333z"/>
  </svg>
)

const HowToUseIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M872.704 938.581333V151.253333a32.810667 32.810667 0 0 0-32.810667-32.810666H216.576a65.621333 65.621333 0 1 0 0 131.242666H774.357333a32.810667 32.810667 0 0 1 32.810667 32.810667v688.853333H216.618667A131.541333 131.541333 0 0 1 85.290667 840.021333V184.021333A131.541333 131.541333 0 0 1 216.618667 52.693333h688.853333A33.109333 33.109333 0 0 1 938.624 85.461333v787.584a33.109333 33.109333 0 0 1-33.152 32.810667 32.768 32.768 0 0 0-32.768 32.682667m-364.544-150.656a42.026667 42.026667 0 0 0-40.533333-43.477334h-2.986667a41.898667 41.898667 0 0 0-43.136 40.704v2.773334a40.277333 40.277333 0 0 0 12.245333 30.378666 40.704 40.704 0 0 0 30.890667 12.586667 42.666667 42.666667 0 0 0 31.232-12.586667 40.448 40.448 0 0 0 12.288-30.378666m-192.725333-263.338667a33.877333 33.877333 0 0 0 12.074666 27.306667 39.082667 39.082667 0 0 0 23.637334 8.917333h2.261333a39.253333 39.253333 0 0 0 21.333333-6.912 25.130667 25.130667 0 0 0 10.581334-21.76 55.850667 55.850667 0 0 1 5.034666-21.333333 95.530667 95.530667 0 0 1 14.592-23.978667 81.493333 81.493333 0 0 1 22.570667-19.498667 57.514667 57.514667 0 0 1 30.08-8.533333 77.226667 77.226667 0 0 1 51.925333 16.341333 46.933333 46.933333 0 0 1 18.133334 41.002667 41.728 41.728 0 0 1-6.954667 22.570667 103.509333 103.509333 0 0 1-18.090667 19.712c-6.656 6.272-13.781333 11.861333-21.333333 17.834666l-2.261333 1.664a277.546667 277.546667 0 0 0-23.466667 20.309334 110.933333 110.933333 0 0 0-18.645333 22.570666 51.2 51.2 0 0 0-8.533334 26.453334l0.896 27.605333a29.226667 29.226667 0 0 0 10.112 20.266667 39.168 39.168 0 0 0 26.410667 10.112 36.352 36.352 0 0 0 26.24-10.581334 25.258667 25.258667 0 0 0 8.533333-22.869333V654.293333a31.786667 31.786667 0 0 1 14.250667-24.277333 280.746667 280.746667 0 0 1 10.112-8.533333c5.461333-4.650667 11.221333-9.6 17.536-14.805334l6.144-5.034666a266.666667 266.666667 0 0 0 34.56-35.498667 77.696 77.696 0 0 0 17.322667-45.610667 169.344 169.344 0 0 0-5.845334-52.352 96.085333 96.085333 0 0 0-23.466666-42.112 122.965333 122.965333 0 0 0-42.666667-27.818666 169.6 169.6 0 0 0-61.610667-10.112 158.208 158.208 0 0 0-72.533333 15.232 147.584 147.584 0 0 0-46.933333 37.333333 128.896 128.896 0 0 0-25.045334 45.184 111.914667 111.914667 0 0 0-6.741333 38.997333" />
  </svg>
)

// Program Trader icon (Python logo - official colors) - used in desktop sidebar
const ProgramTraderIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M508.416 3.584c-260.096 0-243.712 112.64-243.712 112.64l0.512 116.736h248.32v34.816H166.4S0 248.832 0 510.976s145.408 252.928 145.408 252.928h86.528v-121.856S227.328 496.64 374.784 496.64h246.272s138.24 2.048 138.24-133.632V139.776c-0.512 0 20.48-136.192-250.88-136.192zM371.712 82.432c24.576 0 44.544 19.968 44.544 44.544 0 24.576-19.968 44.544-44.544 44.544-24.576 0-44.544-19.968-44.544-44.544-0.512-24.576 19.456-44.544 44.544-44.544z" fill="#3773A5"/>
    <path d="M515.584 1022.464c260.096 0 243.712-112.64 243.712-112.64l-0.512-116.736H510.976V757.76h346.624s166.4 18.944 166.4-243.2-145.408-252.928-145.408-252.928h-86.528v121.856s4.608 145.408-142.848 145.408h-245.76s-138.24-2.048-138.24 133.632v224.768c0-0.512-20.992 135.168 250.368 135.168z m136.704-78.336c-24.576 0-44.544-19.968-44.544-44.544 0-24.576 19.968-44.544 44.544-44.544 24.576 0 44.544 19.968 44.544 44.544 0.512 24.576-19.456 44.544-44.544 44.544z" fill="#FFD731"/>
  </svg>
)

// Mobile Programs tab icon (workflow/automation style)
const MobileProgramsIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M800 738.667h-0.107L512 738.24c-17.707 0-32-14.4-32-32 0-17.707 14.293-32 32-32l288 0.32c52.907 0 96-43.093 96-96V432.427c0-52.907-43.093-96-96-96h-80c-17.707 0-32-14.294-32-32s14.293-32 32-32h80c88.213 0 160 71.786 160 160v146.24c0 88.213-71.787 160-160 160z m-509.547 0.106H224c-88.213 0-160-71.786-160-160v-146.24c0-88.213 71.787-160 160-160h0.107l287.893 0.32c17.707 0 32 14.4 32 32 0 17.707-14.293 32-32 32l-288-0.32c-52.907 0-96 43.094-96 96v146.24c0 52.907 43.093 96 96 96h66.453c17.707 0 32 14.294 32 32s-14.293 32-32 32z"/>
    <path d="M592 537.707H422.827c-17.707 0-32-14.294-32-32s14.293-32 32-32H592c52.907 0 96-43.094 96-96V231.253c0-52.906-43.093-96-96-96h-20.48c-17.707 0-32-14.293-32-32s14.293-32 32-32H592c88.213 0 160 71.787 160 160V377.6c0 88.32-71.787 160.107-160 160.107z"/>
    <path d="M540.267 953.6H432c-88.213 0-160-71.787-160-160v-160c0-88.213 71.787-160 160-160h144v64H432c-52.907 0-96 43.093-96 96v160c0 52.907 43.093 96 96 96h108.267v64z"/>
    <path d="M592 953.6h-80v-64h80c52.907 0 96-43.093 96-96V683.84h64V793.6c0 88.213-71.787 160-160 160zM350.827 327.36h-64v-96c0-88.213 71.786-160 160-160H576v64H446.827c-52.907 0-96 43.093-96 96v96z"/>
    <path d="M405.867 207.04a41.6 41.6 0 1 0 83.2 0 41.6 41.6 0 1 0-83.2 0zM553.813 810.453a41.6 41.6 0 1 0 83.2 0 41.6 41.6 0 1 0-83.2 0z"/>
  </svg>
)

// English language icon (En)
const EnglishIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M579.2 478.4h-9.6l36.8 206.4c24.8-8.8 47.2-21.6 66.4-39.2-20-24.8-36.8-52-49.6-80.8l39.2-4.8c10.4 21.6 23.2 41.6 36.8 58.4 28.8-35.2 51.2-81.6 66.4-140.8l-186.4 0.8z m148 167.2c22.4 19.2 48 33.6 76 42.4l17.6 5.6-10.4 38.4-17.6-5.6c-34.4-10.4-65.6-28.8-92.8-52.8-24.8 22.4-54.4 40-86.4 50.4l24.8 139.2H490.4l-20 91.2h467.2c21.6 0 40-17.6 40-40V240c0-21.6-17.6-40-40-40H520l31.2 172.8-0.8-0.8 3.2 19.2 0.8-2.4 8.8 49.6h96v-40h74.4v40h124v40h-52c-16.8 69.6-44 125.6-78.4 167.2z m-277.6 217.6H87.2c-44 0-79.2-36-79.2-79.2V108.8c0-44 36-79.2 79.2-79.2h396.8l24.8 131.2h428c44 0 79.2 36 79.2 79.2v675.2c0 44-36 79.2-79.2 79.2H420.8l28.8-131.2zM262.4 557.6v-41.6H184v-61.6h72.8v-41.6H184V360h78.4v-41.6H137.6v238.4h124.8v0.8z m191.2 0V438.4c0-21.6-4.8-38.4-14.4-49.6-9.6-12-24.8-17.6-44-17.6-11.2 0-21.6 2.4-30.4 6.4-8.8 4.8-16 12-20 20h-2.4l-6.4-23.2h-34.4v182.4h44.8V471.2c0-21.6 3.2-36.8 8.8-46.4 5.6-8.8 14.4-13.6 27.2-13.6 8.8 0 16 3.2 20 9.6 4 6.4 6.4 16 6.4 29.6v107.2h44.8z" fill="#13227a"/>
  </svg>
)

// Chinese language icon (中)
const ChineseIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M219.4 363.4c11.8 35 31.4 65.4 58.7 92.2 23.2-25.2 40.7-56.2 52-92.2H219.4z m722.2-207.1H508.9L484.2 23.9H82.4C38.1 23.9 2 60 2 104.3v683.1c0 44.3 36.1 80.4 80.4 80.4h366.3l-29.4 132.4h522.4c44.3 0 80.4-36.1 80.4-80.4V236.7c-0.1-44.4-36.2-80.4-80.5-80.4zM396.1 562.2c-47.4-17.5-86.5-39.7-118-65.4-33 29.4-74.2 51-122.1 64.4l-16.5-27.3c46.9-12.4 86-30.9 116.9-57.2-31.9-32.5-54.1-70.1-66.5-112.8h-44.8V333H262c-7.2-13.4-16.5-26.3-27.3-38.6l30.9-11.3c10.8 13.9 20.6 30.4 29.4 49.5h111.8v30.9H362c-14.4 44.3-35 81.4-62.3 111.3 30.4 24.2 68.5 44.3 113.3 60.8l-16.9 26.6z m585.7 357c0 22.2-18 40.2-40.2 40.2H469.8l20.1-92.2h150.9l-86-479.6-0.5 2.6-3.6-19.1 1 0.5-31.4-175.2h421.9c22.2 0 40.2 18 40.2 40.2v682.6h-0.6zM655.2 540.1H766v-29.4H655.2V452h118v-29.4H620.7v211.2h157.1v-29.4H655.2v-64.3z m231.3-63.4c-9.3 0-17.5 1.5-25.2 5.7-7.2 3.6-14.4 9.3-20.1 16.5v-18h-33.5v153h33.5v-92.2c1-12.4 5.2-21.6 12.4-28.3 6.2-5.7 13.4-8.8 21.6-8.8 23.2 0 34.5 12.4 34.5 37.6v91.2h33.5V539c1-41.7-18.6-62.3-56.7-62.3z" fill="#d81e06"/>
  </svg>
)

// Settings icon (gear)
const SettingsIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M486.4 921.6a112.1792 112.1792 0 0 1-103.4752-65.1264l-26.2656-57.1904a63.232 63.232 0 0 0-63.7952-34.9696l-64.768 6.7584a112.3328 112.3328 0 0 1-111.7184-56.7296 105.9328 105.9328 0 0 1 8.4992-117.76l38.4512-50.432a55.9616 55.9616 0 0 0 0-68.4032l-38.4512-50.432a105.9328 105.9328 0 0 1-8.4992-117.76 112.2816 112.2816 0 0 1 111.7184-56.6784l64.7168 6.7072a62.1568 62.1568 0 0 0 63.7952-34.9696l26.3168-57.1904a114.8416 114.8416 0 0 1 207.0528 0l26.2656 57.1392a62.8224 62.8224 0 0 0 63.7952 34.9696l64.7168-6.7072a111.8208 111.8208 0 0 1 111.7184 56.6784 106.0352 106.0352 0 0 1-8.448 117.76l-38.4512 50.432a55.808 55.808 0 0 0 0 68.4032l38.4512 50.432a106.0352 106.0352 0 0 1 8.448 117.76 111.9744 111.9744 0 0 1-111.7184 56.7296l-64.7168-6.7584a62.4128 62.4128 0 0 0-63.7952 34.9696l-26.2656 57.1904A112.2304 112.2304 0 0 1 486.4 921.6z" fill="#FFD9C1"/>
    <path d="M506.88 532.48m-153.6 0a153.6 153.6 0 1 0 307.2 0 153.6 153.6 0 1 0-307.2 0Z" fill="#9E3200" opacity=".2"/>
    <path d="M486.4 537.6m-128 0a128 128 0 1 0 256 0 128 128 0 1 0-256 0Z" fill="#FFF9F5"/>
    <path d="M162.304 750.2336a25.6 25.6 0 0 1-23.0912-14.5408 110.1824 110.1824 0 0 1 9.5744-112.64l35.84-50.432a60.5696 60.5696 0 0 0 0-69.888l-35.84-50.3808a110.6432 110.6432 0 0 1-5.12-121.4976 105.728 105.728 0 0 1 103.2192-52.224l60.0576 6.7584a55.2448 55.2448 0 0 0 56.9856-34.3552l24.3712-57.1392a105.984 105.984 0 0 1 150.5792-51.9168 25.6 25.6 0 0 1-25.6 44.4416 54.8352 54.8352 0 0 0-78.08 27.5456l-24.3712 57.1904a106.5472 106.5472 0 0 1-109.7728 65.1264l-60.0576-6.7584a53.76 53.76 0 0 0-53.4016 27.3408 60.0064 60.0064 0 0 0 2.6112 65.8432l35.84 50.432a111.8208 111.8208 0 0 1 0 129.0752l-35.84 50.432a59.7504 59.7504 0 0 0-5.12 61.0816 25.6 25.6 0 0 1-12.032 34.1504 25.9072 25.9072 0 0 1-10.752 2.3552z" fill="#9E3200" opacity=".2"/>
    <path d="M383.0272 856.5248l-26.4192-57.1904a63.3856 63.3856 0 0 0-63.744-34.9184l-64.768 6.7072a112.1792 112.1792 0 0 1-111.8208-56.7808 105.9328 105.9328 0 0 1 8.448-117.504l38.6048-50.5856a55.9616 55.9616 0 0 0 0-68.1984l-38.6048-50.4832a106.4448 106.4448 0 0 1-8.448-117.76 112.64 112.64 0 0 1 111.8208-56.7808l64.768 7.0144a62.5152 62.5152 0 0 0 63.744-35.1744l26.4192-56.9856a114.688 114.688 0 0 1 206.9504 0l26.1632 56.9856a63.6928 63.6928 0 0 0 64 35.2256l64.512-7.0144a112.0768 112.0768 0 0 1 111.8208 56.7808 106.4448 106.4448 0 0 1-8.448 117.76l-38.3488 50.4832a55.2448 55.2448 0 0 0 0 68.1984l38.3488 50.5856a105.9328 105.9328 0 0 1 8.448 117.504 111.7184 111.7184 0 0 1-111.8208 56.7808l-64.512-6.7072a62.6176 62.6176 0 0 0-64 34.9184l-26.1632 57.1904a114.6368 114.6368 0 0 1-206.9504 0z m20.1728-78.3872l26.1632 56.9856a63.6928 63.6928 0 0 0 114.1248 0l26.368-56.9856a113.6128 113.6128 0 0 1 115.6096-64.8192l64.768 7.0144a62.6688 62.6688 0 0 0 61.7472-31.0784 55.04 55.04 0 0 0-4.5056-61.44l-38.6048-50.2784a106.8544 106.8544 0 0 1 0-130.5088l38.6048-50.5856a55.04 55.04 0 0 0 4.5056-61.44 62.5664 62.5664 0 0 0-61.7472-30.72l-64.768 6.8096a113.152 113.152 0 0 1-115.6096-64.512l-26.368-57.2928a63.8976 63.8976 0 0 0-114.1248 0l-26.1632 57.2928a112.9984 112.9984 0 0 1-115.5584 64.512l-64.768-6.8096a62.6176 62.6176 0 0 0-61.7472 30.72 54.1184 54.1184 0 0 0 4.5056 61.44l38.3488 50.5856a106.2912 106.2912 0 0 1 0 130.5088l-38.3488 50.2784a54.1696 54.1696 0 0 0-4.5056 61.44 62.208 62.208 0 0 0 61.7472 31.0784l64.768-7.0144c3.9936 0 8.2432-0.4096 12.1856-0.4096a113.152 113.152 0 0 1 103.3728 65.4336z m-70.4512-266.24a153.6 153.6 0 1 1 153.6 153.6 153.6 153.6 0 0 1-153.4464-153.3952z m51.2 0a102.4 102.4 0 1 0 102.4-102.4 102.7072 102.7072 0 0 0-102.2464 102.6048z" fill="#9E3200"/>
  </svg>
)

interface SidebarProps {
  currentPage?: string
  onPageChange?: (page: string) => void
  onAccountUpdated?: () => void
}

export default function Sidebar({ currentPage = 'comprehensive', onPageChange, onAccountUpdated }: SidebarProps) {
  const { t, i18n } = useTranslation()
  const { tradingMode, setTradingMode } = useTradingMode()
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<TradingMode | null>(null)

  const handleModeClick = (mode: TradingMode) => {
    if (mode === tradingMode) return
    setConfirmTarget(mode)
  }

  const handleModeConfirm = () => {
    if (confirmTarget) {
      setTradingMode(confirmTarget)
    }
    setConfirmTarget(null)
  }

  const desktopNav = [
    { label: t('hyperAi.title', 'Hyper AI'), page: 'hyper-ai', icon: Bot },
    { label: t('sidebar.dashboard'), page: 'comprehensive', icon: BarChart3 },
    { label: t('sidebar.aiTrader', 'AI Trader'), page: 'trader-management', icon: Ghost },
    { label: t('sidebar.prompts', 'Prompts'), page: 'prompt-management', icon: NotebookPen },
    { label: t('sidebar.programTrader', 'Program Trader'), page: 'program-trader', icon: ScrollText },
    { label: t('sidebar.signals', 'Signals'), page: 'signal-management', icon: SignalIcon },
    { label: t('sidebar.attribution', 'Attribution'), page: 'attribution', icon: AttributionIcon },
    { label: t('sidebar.factorLibrary', 'Factors'), page: 'factor-library', icon: FlaskConical },
    { label: t('sidebar.manualTrading', 'Manual Trading'), page: 'hyperliquid', icon: Coins },
    { label: t('sidebar.klines', 'K-Lines'), page: 'klines', icon: KLinesIcon },
    { label: t('sidebar.premium', 'Premium'), page: 'premium-features', icon: PremiumIcon },
    { label: t('sidebar.systemLogs', 'System Logs'), page: 'system-logs', icon: FileText },
  ] as const

  const isTestnet = tradingMode === 'testnet'

  return (
    <>
      {/* Desktop Sidebar - Hidden on mobile */}
      <aside className="hidden md:flex w-56 border-r h-full flex-col fixed md:relative left-0 top-0 z-50 bg-background">

        {/* Top: Brand */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <img src="/static/logo_app.png" alt="Logo" className="h-7 w-7 object-contain flex-shrink-0" />
            <span className="text-base font-bold">Hyper Alpha Arena</span>
          </div>
        </div>

        {/* Environment: Exchange + Trading Mode */}
        <div className="px-3 pb-3 space-y-2">
          {/* Exchange */}
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{t('sidebar.exchange', 'Exchange')}</span>
            <button
              onClick={() => setIsExchangeModalOpen(true)}
              className="flex flex-col gap-1.5 w-full mt-1.5 rounded-md hover:bg-muted/60 transition-colors px-1 py-1"
              title={t('exchange.supportedExchanges', 'Supported Exchanges')}
            >
              <div className="flex items-center gap-2.5">
                <ExchangeIcon exchangeId="hyperliquid" size={18} />
                <span className="text-sm text-foreground">Hyperliquid</span>
              </div>
              <div className="flex items-center gap-2.5">
                <ExchangeIcon exchangeId="binance" size={18} />
                <span className="text-sm text-foreground">Binance</span>
              </div>
            </button>
          </div>

          {/* Trading Mode */}
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">{t('sidebar.tradingMode', 'Trading Mode')}</span>
            <TooltipProvider delayDuration={400}>
              <div className="flex rounded-lg border border-border overflow-hidden mt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleModeClick('testnet')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-all ${
                        isTestnet
                          ? 'bg-blue-500 text-white'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Testnet
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    <p className="text-xs">{t('tradingMode.testnetDesc', 'Practice with test funds. Prices and volume differ from Mainnet. No real money at risk.')}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleModeClick('mainnet')}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-all ${
                        !isTestnet
                          ? 'bg-red-500 text-white'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Mainnet
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[220px]">
                    <p className="text-xs">{t('tradingMode.mainnetDesc', 'Real money trading. Signal and market flow data is collected here. Losses are permanent.')}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>
        </div>

        {/* Middle: Navigation (scrollable) */}
        <nav className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col space-y-1.5">
            {desktopNav.map((item) => {
              const Icon = item.icon
              const isActive = currentPage === item.page
              return (
                <button
                  key={item.page}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-secondary/80 text-[#B8860B]' : 'hover:text-[#B8860B] text-muted-foreground'
                  }`}
                  onClick={() => onPageChange?.(item.page)}
                  title={item.label}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Bottom: Icon toolbar + version */}
        <div className="px-4 py-2 space-y-1">
          <TooltipProvider delayDuration={300}>
            <div className="flex items-center justify-around">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded-md text-muted-foreground hover:text-[#B8860B] hover:bg-muted transition-colors"
                    onClick={() => window.open('https://www.akooi.com/docs/guide/getting-started.html', '_blank', 'noopener,noreferrer')}
                  >
                    <HowToUseIcon className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('sidebar.howToUse', 'How to Use')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <ContactDialog>
                    <button className="p-2 rounded-md text-muted-foreground hover:text-[#B8860B] hover:bg-muted transition-colors">
                      <Mail className="w-4 h-4" />
                    </button>
                  </ContactDialog>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('contact.contactAuthor', 'Contact Author')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`p-2 rounded-md transition-colors ${
                      currentPage === 'settings'
                        ? 'text-[#B8860B] bg-secondary/80'
                        : 'text-muted-foreground hover:text-[#B8860B] hover:bg-muted'
                    }`}
                    onClick={() => onPageChange?.('settings')}
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{t('sidebar.settings', 'Settings')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded-md text-muted-foreground hover:text-[#B8860B] hover:bg-muted transition-colors"
                    onClick={() => window.open('https://github.com/HammerGPT/Hyper-Alpha-Arena', '_blank', 'noopener,noreferrer')}
                  >
                    <Github className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>GitHub</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
          <div className="text-center">
            <a
              href="https://www.akooi.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              akooi.com
            </a>
            <span className="text-[10px] text-muted-foreground mx-1">·</span>
            <span className="text-[10px] text-muted-foreground">v{__APP_VERSION__}</span>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation - 4 tabs: Dashboard, K-Lines, Chat, Programs */}
      <nav className="md:hidden flex flex-row items-center justify-around fixed bottom-0 left-0 right-0 bg-background border-t h-16 px-2 z-50">
        <button
          className={`flex flex-col items-center justify-center flex-1 h-12 rounded-lg transition-colors ${
            currentPage === 'comprehensive'
              ? 'bg-secondary/80 text-secondary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          }`}
          onClick={() => onPageChange?.('comprehensive')}
          title="Dashboard"
        >
          <BarChart3 className="w-5 h-5" />
          <span className="text-xs mt-1">Dashboard</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center flex-1 h-12 rounded-lg transition-colors ${
            currentPage === 'klines'
              ? 'bg-secondary/80 text-secondary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          }`}
          onClick={() => onPageChange?.('klines')}
          title="K-Lines"
        >
          <KLinesIcon className="w-5 h-5" />
          <span className="text-xs mt-1">K-Lines</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center flex-1 h-12 rounded-lg transition-colors ${
            currentPage === 'model-chat'
              ? 'bg-secondary/80 text-secondary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          }`}
          onClick={() => onPageChange?.('model-chat')}
          title="Chat"
        >
          <MessageSquare className="w-5 h-5" />
          <span className="text-xs mt-1">Chat</span>
        </button>
        <button
          className={`flex flex-col items-center justify-center flex-1 h-12 rounded-lg transition-colors ${
            currentPage === 'program-trader'
              ? 'bg-secondary/80 text-secondary-foreground'
              : 'hover:bg-muted text-muted-foreground'
          }`}
          onClick={() => onPageChange?.('program-trader')}
          title="Programs"
        >
          <MobileProgramsIcon className="w-5 h-5" />
          <span className="text-xs mt-1">Programs</span>
        </button>
      </nav>

      {/* Modals */}
      <ExchangeModal
        isOpen={isExchangeModalOpen}
        onClose={() => setIsExchangeModalOpen(false)}
      />
      <TradingModeConfirmDialog
        isOpen={confirmTarget !== null}
        targetMode={confirmTarget}
        onConfirm={handleModeConfirm}
        onCancel={() => setConfirmTarget(null)}
      />
    </>
  )
}
