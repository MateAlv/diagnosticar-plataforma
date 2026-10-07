import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Términos y privacidad · Diagnostic.ar",
    description: "Términos de uso de Diagnostic.ar y cómo tratamos tus datos.",
};

const CONTACTO = "diagnosticar.ar@gmail.com";
const ACTUALIZADO = "7 de octubre de 2026";
const RESPONSABLE = "Grupo de Genómica Clínica, Facultad de Ciencias Exactas y Naturales, Universidad de Buenos Aires";
const DOMICILIO = "Intendente Güiraldes 2160, Ciudad Universitaria, C1428EGA, Ciudad Autónoma de Buenos Aires";

function Seccion({ id, titulo, children }: { id?: string; titulo: string; children: React.ReactNode }) {
    return (
        <section id={id} className="scroll-mt-24">
            <h2 className="text-xl font-bold text-[var(--lu-text)]">{titulo}</h2>
            <div className="mt-3 space-y-3 text-base leading-relaxed text-[var(--lu-text)]">{children}</div>
        </section>
    );
}

/**
 * Terms of use and the privacy notice, in one page so the sign-up checkbox and
 * the footer link to something real. Plain on purpose: every statement here
 * describes what the platform actually does (what is stored, who processes the
 * text, where it lives), not boilerplate that promises more.
 */
export default function TerminosPage() {
    return (
        <main className="min-h-screen bg-[var(--lu-bg)] px-4 py-10 sm:px-6">
            <div className="mx-auto max-w-3xl">
                <Link href="/home" className="text-sm font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                    ← Volver al inicio
                </Link>

                <h1 className="mt-6 text-3xl font-bold text-[var(--lu-text)]">Términos de uso y privacidad</h1>
                <p className="mt-2 text-sm text-[var(--lu-subtle)]">Última actualización: {ACTUALIZADO}</p>

                <nav aria-label="Secciones" className="mt-6 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4 text-sm">
                    <ul className="flex flex-wrap gap-x-5 gap-y-2">
                        <li><a href="#que-es" className="text-[var(--lu-accent-text)] underline underline-offset-2">Qué es</a></li>
                        <li><a href="#uso" className="text-[var(--lu-accent-text)] underline underline-offset-2">Uso</a></li>
                        <li><a href="#privacidad" className="text-[var(--lu-accent-text)] underline underline-offset-2">Privacidad</a></li>
                        <li><a href="#datos-de-salud" className="text-[var(--lu-accent-text)] underline underline-offset-2">Datos de salud</a></li>
                        <li><a href="#conservacion" className="text-[var(--lu-accent-text)] underline underline-offset-2">Conservación y borrado</a></li>
                        <li><a href="#derechos" className="text-[var(--lu-accent-text)] underline underline-offset-2">Tus derechos</a></li>
                        <li><a href="#ley" className="text-[var(--lu-accent-text)] underline underline-offset-2">Ley aplicable</a></li>
                    </ul>
                </nav>

                <div className="mt-10 space-y-10">
                    <Seccion id="que-es" titulo="1. Qué es Diagnostic.ar">
                        <p>
                            Diagnostic.ar es una herramienta gratuita que, a partir de los síntomas que cargás,
                            sugiere genes que podrían estar relacionados y especialidades médicas para consultar.
                            La desarrolla el Grupo de Genómica Clínica de la Facultad de Ciencias Exactas y Naturales
                            de la Universidad de Buenos Aires, junto con instituciones colaboradoras.
                        </p>
                        <p>
                            <strong>Responsable de los datos:</strong> {RESPONSABLE}. {DOMICILIO}. Contacto:{" "}
                            <a href={`mailto:${CONTACTO}`} className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                {CONTACTO}
                            </a>
                            .
                        </p>
                        <p>
                            <strong>No es un diagnóstico médico ni reemplaza una consulta con un profesional de la
                            salud.</strong> Los resultados son una orientación calculada por un sistema informático y
                            pueden tener errores. Cualquier decisión sobre estudios o tratamientos la tiene que tomar
                            un profesional.
                        </p>
                        <p>
                            <strong>No es un servicio de urgencias.</strong> Si hay una urgencia, andá a la guardia
                            más cercana o llamá al 107.
                        </p>
                    </Seccion>

                    <Seccion id="uso" titulo="2. Uso de la plataforma">
                        <ul className="list-disc space-y-2 pl-5">
                            <li>Para crear una cuenta tenés que ser mayor de 18 años.</li>
                            <li>
                                Si cargás información sobre otra persona (por ejemplo, tu hijo o hija), tenés que ser su
                                responsable o contar con su autorización.
                            </li>
                            <li>
                                Sos responsable de la información que cargás. No hace falta que incluyas nombre completo,
                                DNI, dirección ni teléfono: alcanza con un apodo y la descripción de los síntomas.
                            </li>
                            <li>Cuidá tu contraseña: es la llave de tu cuenta.</li>
                            <li>
                                La plataforma se ofrece «tal como está», sin garantía de disponibilidad continua ni de
                                exactitud de los resultados. No somos responsables por decisiones tomadas solo en base a
                                ellos.
                            </li>
                            <li>
                                Podemos modificar estos términos. Cuando cambian, te pedimos que los aceptes de nuevo
                                antes de seguir usando la plataforma.
                            </li>
                        </ul>
                    </Seccion>

                    <Seccion id="privacidad" titulo="3. Qué datos guardamos y para qué">
                        <p>Guardamos lo necesario para que la herramienta funcione y puedas volver a tus búsquedas:</p>
                        <ul className="list-disc space-y-2 pl-5">
                            <li>
                                <strong>Tu cuenta:</strong> email y el nombre o apodo que elijas. Si entrás con Google,
                                también el nombre y el email de esa cuenta de Google. Si tu cuenta tenía contraseña y
                                entrás con Google, desde ese momento se entra solo con Google.
                            </li>
                            <li>
                                <strong>Las personas que cargás:</strong> los datos que indiques, todos opcionales:
                                apodo (sin apodo, la numeramos «Paciente 1», «Paciente 2»…), fecha de nacimiento, sexo,
                                localidad y país.
                            </li>
                            <li>
                                <strong>Cada búsqueda:</strong> el texto que pegues, los síntomas, los resultados y, si
                                las usás, tus respuestas a las preguntas de seguimiento.
                            </li>
                        </ul>
                        <p>
                            Los usamos para mostrarte los resultados, guardarlos en tu cuenta, cuidar la seguridad de
                            la plataforma y, siempre de forma agregada y sin identificar a nadie, para medir su uso y
                            mejorarla. <strong>No vendemos ni compartimos tus datos con fines comerciales.</strong>
                        </p>
                        <p>
                            Los datos se alojan en servidores de la Facultad de Ciencias Exactas y Naturales de la
                            Universidad de Buenos Aires.
                        </p>
                    </Seccion>

                    <Seccion id="datos-de-salud" titulo="4. Datos de salud y su tratamiento fuera del país">
                        <p>
                            Los síntomas, el relato y las respuestas son <strong>datos de salud</strong>, que la Ley
                            25.326 considera datos sensibles. Al aceptar estos términos nos das tu consentimiento para
                            tratarlos como se explica en esta página: para darte la orientación, guardarla en tu cuenta
                            y, sin identificar a nadie, medir el uso de la herramienta y mejorarla.
                        </p>
                        <p>
                            Para reconocer los síntomas en el texto y para redactar las preguntas de seguimiento, el
                            texto se envía a un servicio de inteligencia artificial de Anthropic, PBC, que lo procesa
                            en <strong>Estados Unidos</strong>. Esa transferencia internacional también forma parte de
                            tu consentimiento. Por eso te recomendamos no incluir en el texto datos que identifiquen a
                            la persona.
                        </p>
                        <p>
                            Podés retirar tu consentimiento cuando quieras borrando tu cuenta (ver la sección 5): se
                            borra todo lo que cargaste.
                        </p>
                    </Seccion>

                    <Seccion id="conservacion" titulo="5. Cuánto tiempo guardamos los datos y cómo borrarlos">
                        <p>
                            <strong>Guardamos todo lo que cargás hasta que lo borres:</strong> tu cuenta, las personas,
                            cada búsqueda con su texto, sus síntomas, sus resultados y tus respuestas. No vence con el
                            tiempo, así podés volver a tus búsquedas cuando
                            quieras.
                        </p>
                        <p>
                            Para identificar a la persona alcanza con un apodo o un número: no pedimos nombre completo,
                            DNI ni dirección. Cuando usamos los datos para medir o mejorar la plataforma, lo hacemos
                            de forma agregada, sin identificar a nadie.
                        </p>
                        <p>
                            Desde{" "}
                            <Link href="/cuenta" className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                Tu cuenta
                            </Link>{" "}
                            podés borrar la cuenta con todo lo que cargaste. Se borra en el momento y no se puede
                            deshacer. Lo borrado puede seguir un tiempo en las copias de seguridad, hasta que se
                            reemplazan solas. Si no podés entrar a tu cuenta, escribinos a{" "}
                            <a href={`mailto:${CONTACTO}`} className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                {CONTACTO}
                            </a>{" "}
                            desde su email y la borramos nosotros.
                        </p>
                    </Seccion>

                    <Seccion id="derechos" titulo="6. Tus derechos">
                        <p>
                            Según la Ley 25.326 de Protección de Datos Personales, podés pedir acceso a tus datos,
                            corregirlos o que los borremos. Borrarlos lo podés hacer vos mismo desde Tu cuenta; para lo
                            demás, escribinos a{" "}
                            <a href={`mailto:${CONTACTO}`} className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                {CONTACTO}
                            </a>{" "}
                            desde el email de tu cuenta y te respondemos dentro de los plazos de la ley.
                        </p>
                        <p>
                            El responsable de la base de datos es el {RESPONSABLE}, que debe inscribirla en el Registro
                            Nacional de Bases de Datos Personales de la Agencia de Acceso a la Información Pública.
                        </p>
                        <p className="text-sm text-[var(--lu-subtle)]">
                            La Agencia de Acceso a la Información Pública, órgano de control de la Ley 25.326, atiende
                            las denuncias y reclamos de quienes resulten afectados en sus derechos por incumplimiento de
                            las normas vigentes en materia de protección de datos personales.
                        </p>
                    </Seccion>

                    <Seccion id="ley" titulo="7. Ley aplicable y jurisdicción">
                        <p>
                            Estos términos se rigen por las leyes de la República Argentina. Cualquier controversia
                            sobre ellos se somete a los tribunales competentes de la Ciudad Autónoma de Buenos Aires.
                        </p>
                        <p>Si los cambiamos, publicamos la versión nueva en esta página con su fecha.</p>
                    </Seccion>
                </div>
            </div>
        </main>
    );
}
